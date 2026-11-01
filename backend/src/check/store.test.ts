import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { migrate, saveRunFindings, type PoolLike } from "./store.js";
import type { CheckJob } from "./queue.js";
import type { StoredFinding } from "../../../shared/finding.js";

function makePool(): PoolLike {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new Pool() as unknown as PoolLike;
}

const JOB: CheckJob = {
  owner: "eteen12",
  repo: "demo-repo",
  prNumber: 42,
  headSha: "sha1",
  issueNumber: 8,
  enqueuedAt: 1000,
};

const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: crypto.randomUUID(),
  repo: "eteen12/demo-repo",
  pr: 42,
  issue: 8,
  item: "discount",
  kind: "conflict",
  issue_quote: "10%",
  note_quote: "5%",
  note_path: "vault/a.md",
  note_date: "2026-10-28",
  diff_line: "+x",
  confidence: 0.9,
  searches: ["grep x"],
  state: "open",
  head_sha: JOB.headSha,
  created_at: new Date(2000).toISOString(),
  ...over,
});

async function rows(pool: PoolLike, state?: string) {
  const q = state
    ? pool.query("SELECT * FROM findings WHERE state = $1 ORDER BY item", [state])
    : pool.query("SELECT * FROM findings ORDER BY item");
  return (await q).rows;
}

describe("saveRunFindings", () => {
  it("inserts findings and records the run in one transaction", async () => {
    const pool = makePool();
    await migrate(pool);
    expect(await saveRunFindings(pool, JOB, [finding()])).toBe("saved");
    expect(await rows(pool)).toHaveLength(1);
    const runs = await pool.query("SELECT * FROM check_runs");
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].head_sha).toBe("sha1");
  });

  it("re-run replaces open findings but preserves approved/dismissed", async () => {
    const pool = makePool();
    await migrate(pool);
    const approved = finding({ item: "approved-one", state: "approved" });
    await pool.query(
      `INSERT INTO findings (id, repo, pr, issue, item, kind, confidence, searches, state, head_sha)
       VALUES ($1, $2, $3, $4, $5, 'conflict', 0.9, '[]', 'approved', 'old-sha')`,
      [approved.id, approved.repo, approved.pr, approved.issue, approved.item],
    );
    await saveRunFindings(pool, { ...JOB, headSha: "sha2", enqueuedAt: 2000 }, [
      finding({ item: "new-one" }),
    ]);
    expect((await rows(pool, "approved")).map((r) => r.item)).toEqual(["approved-one"]);
    expect((await rows(pool, "open")).map((r) => r.item)).toEqual(["new-one"]);
  });

  it("zero findings still deletes the previous open findings", async () => {
    const pool = makePool();
    await migrate(pool);
    await saveRunFindings(pool, JOB, [finding({ item: "old" })]);
    await saveRunFindings(pool, { ...JOB, headSha: "sha2", enqueuedAt: 2000 }, []);
    expect(await rows(pool, "open")).toHaveLength(0);
    expect(await rows(pool)).toHaveLength(0);
  });

  it("an older run finishing after a newer run is discarded — store untouched", async () => {
    const pool = makePool();
    await migrate(pool);
    const newer = { ...JOB, headSha: "sha2", enqueuedAt: 2000 };
    await saveRunFindings(pool, newer, [finding({ item: "newer" })]);
    expect(await saveRunFindings(pool, JOB, [finding({ item: "older" })])).toBe("discarded");
    expect((await rows(pool)).map((r) => r.item)).toEqual(["newer"]);
  });

  it("a failing insert rolls the transaction back instead of committing", async () => {
    // pg-mem doesn't enforce transactions; a scripted pool verifies our path.
    const issued: string[] = [];
    const client = {
      async query(text: string, _params?: unknown[]) {
        issued.push(text.trim().split(/\s/)[0]);
        if (text.includes("INSERT INTO findings") && issued.filter((s) => s === "INSERT").length > 2) {
          throw new Error("insert exploded");
        }
        return { rows: text.startsWith("SELECT max") ? [{ newest: null }] : [], rowCount: 0 };
      },
      release() {},
    };
    const pool: PoolLike = {
      query: (t, p) => client.query(t, p),
      connect: async () => client,
    };
    await expect(saveRunFindings(pool, JOB, [finding(), finding()])).rejects.toThrow("insert exploded");
    expect(issued[0]).toBe("BEGIN");
    expect(issued.at(-1)).toBe("ROLLBACK");
    expect(issued).not.toContain("COMMIT");
  });
});
