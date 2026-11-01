import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { StoredFinding } from "../../../shared/finding.js";
import type { CheckJob } from "./queue.js";

/** Minimal Pool/Client surface — satisfied by pg.Pool and pg-mem's adapter. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface PoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** Apply each migrations/*.sql once, in filename order. */
export async function migrate(pool: PoolLike): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if ((applied.rowCount ?? 0) > 0) continue;
    await pool.query(await readFile(MIGRATIONS_DIR + file, "utf8"));
    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
  }
}

const FINDING_COLUMNS = [
  "id", "repo", "pr", "issue", "item", "kind", "issue_quote", "note_quote",
  "note_path", "note_date", "diff_line", "confidence", "searches", "state",
  "head_sha", "created_at",
] as const;

/**
 * #17 — replace a PR's open findings with a new run's findings, atomically.
 * One transaction: pr_runs upsert takes a per-PR row lock; a finished run with
 * a later enqueued_at means this run is stale -> rollback, store untouched.
 */
export async function saveRunFindings(
  pool: PoolLike,
  job: CheckJob,
  findings: StoredFinding[],
): Promise<"saved" | "discarded"> {
  const repo = `${job.owner}/${job.repo}`;
  const enqueued = new Date(job.enqueuedAt);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO pr_runs (repo, pr, last_enqueued_at) VALUES ($1, $2, $3)
       ON CONFLICT (repo, pr)
       DO UPDATE SET last_enqueued_at = EXCLUDED.last_enqueued_at`,
      [repo, job.prNumber, enqueued],
    );
    const { rows } = await client.query(
      `SELECT max(enqueued_at) AS newest FROM check_runs
       WHERE repo = $1 AND pr = $2 AND status = 'done'`,
      [repo, job.prNumber],
    );
    const newest = rows[0].newest as Date | null;
    if (newest && newest.getTime() > job.enqueuedAt) {
      await client.query("ROLLBACK");
      return "discarded";
    }
    await client.query("DELETE FROM findings WHERE repo = $1 AND pr = $2 AND state = 'open'", [
      repo,
      job.prNumber,
    ]);
    for (const f of findings) {
      await client.query(
        `INSERT INTO findings (${FINDING_COLUMNS.join(", ")})
         VALUES (${FINDING_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
        [
          f.id, f.repo, f.pr, f.issue, f.item, f.kind, f.issue_quote, f.note_quote,
          f.note_path, f.note_date, f.diff_line, f.confidence, JSON.stringify(f.searches),
          f.state, f.head_sha, f.created_at,
        ],
      );
    }
    await client.query(
      `INSERT INTO check_runs (repo, pr, head_sha, enqueued_at, status)
       VALUES ($1, $2, $3, $4, 'done')`,
      [repo, job.prNumber, job.headSha, enqueued],
    );
    await client.query("COMMIT");
    return "saved";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
