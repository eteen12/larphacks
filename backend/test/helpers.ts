import { createApp } from "../src/app";
import type { ActionDeps } from "../src/actions/decisions";
import { DEMO_REPO, fixtureFindings } from "../src/actions/fixtures";
import { newDb } from "pg-mem";
import { createDbFindingsStore, FakeFindingsStore, FindingsStoreError, type FindingsStore } from "../src/actions/findings-store";
import { migrate, type PoolLike } from "../src/check/store";
import type { Finding } from "../src/finding";
import { FakeGitHub } from "../src/actions/github.fake";

export const API_KEY = "test-key";
export const REPO = DEMO_REPO;
export const NOW = new Date("2026-10-28T15:00:00Z");

/** pg-mem Postgres with the real migrations and the fixtures seeded. */
export function seededPool(seed: Finding[]): { pool: PoolLike; ready: Promise<void> } {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool() as unknown as PoolLike;
  const ready = (async () => {
    await migrate(pool);
    for (const [i, f] of seed.entries()) {
      // Newest first matches fixture order.
      await pool.query(
        `INSERT INTO findings (id, repo, pr, issue, item, kind, issue_quote, note_quote, note_path, note_date, diff_line, confidence, searches, state, head_sha, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'abc123',$15)`,
        [f.id, f.repo, f.pr, f.issue, f.item, f.kind, f.issue_quote, f.note_quote, f.note_path, f.note_date, f.diff_line, f.confidence, JSON.stringify(f.searches), f.state, new Date(Date.UTC(2026, 9, 28, 14, 0, 0) - i * 1000)],
      );
    }
  })();
  return { pool, ready };
}

/** The DB store over pg-mem, with the same recording hooks as FakeFindingsStore so every approve/dismiss/MCP test runs on it. */
export class RecordingDbStore implements FindingsStore {
  readonly stateChanges: { id: string; state: string }[] = [];
  readonly pool: PoolLike;
  private readonly ready: Promise<void>;
  private readonly inner: FindingsStore;
  private failSetState = 0;

  constructor(seed: Finding[]) {
    ({ pool: this.pool, ready: this.ready } = seededPool(seed));
    this.inner = createDbFindingsStore(this.pool);
  }

  failNextSetState(): this {
    this.failSetState++;
    return this;
  }

  async get(id: string) {
    await this.ready;
    return this.inner.get(id);
  }

  async setState(id: string, state: "approved" | "dismissed") {
    await this.ready;
    if (this.failSetState > 0) {
      this.failSetState--;
      throw new FindingsStoreError(500, "Findings store write failed (fake)");
    }
    await this.inner.setState(id, state);
    this.stateChanges.push({ id, state });
  }

  async listByIssue(repo: string, issue: number) {
    await this.ready;
    return this.inner.listByIssue(repo, issue);
  }

  async headSha(id: string) {
    await this.ready;
    return this.inner.headSha(id);
  }

  async countOpenOnPr(repo: string, pr: number) {
    await this.ready;
    return this.inner.countOpenOnPr(repo, pr);
  }
}

/** FINDINGS_STORE=db (the "db" vitest project) runs the same tests against the DB-backed store. */
export const USE_DB = process.env.FINDINGS_STORE === "db";

export function setup() {
  // Issue #12 is closed (it was shipped), PR #40 is the drifted PR, #15 and #41 belong to another task.
  const github = new FakeGitHub().addIssue(REPO, 12, "closed").addIssue(REPO, 40, "open").addIssue(REPO, 15, "closed").addIssue(REPO, 41, "open");
  const findings = USE_DB ? new RecordingDbStore(fixtureFindings) : new FakeFindingsStore(fixtureFindings);
  const deps: ActionDeps = { github, findings, now: () => NOW };
  const app = createApp({ actions: deps, apiKey: API_KEY });

  async function post(path: string, body?: unknown, key: string | null = API_KEY) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key === null ? {} : { "x-api-key": key }) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  return { github, findings, deps, app, post };
}
