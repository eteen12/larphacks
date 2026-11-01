import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { decisionsMd } from "./decisions.js";
import { agentStage, githubContextStage } from "./stages.js";
import { listDismissedForIssue, migrate, saveRunFindings, setFindingState, type PoolLike } from "./store.js";
import type { CheckContext } from "./run-check.js";
import type { CheckJob } from "./queue.js";
import type { StoredFinding } from "../../../shared/finding.js";

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});
afterEach(() => vi.unstubAllGlobals());

async function makePool(): Promise<PoolLike> {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool() as unknown as PoolLike;
  await migrate(pool);
  return pool;
}

const JOB: CheckJob = {
  owner: "eteen12",
  repo: "demo",
  prNumber: 42,
  headSha: "sha1",
  issueNumber: 8,
  enqueuedAt: 1000,
};

const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: crypto.randomUUID(),
  repo: "eteen12/demo",
  pr: 42,
  issue: 8,
  item: "discount",
  kind: "conflict",
  issue_quote: "Discount is 10%",
  note_quote: "Discount is 5%",
  note_path: "vault/notes/2026-10-28.md",
  note_date: "2026-10-28",
  diff_line: "+const discount = 0.1",
  confidence: 0.9,
  searches: [],
  state: "open",
  head_sha: "sha1",
  created_at: new Date(2000).toISOString(),
  ...over,
});

/** Save findings through the real store, then set states (open ones stay open). */
async function seed(pool: PoolLike, items: Array<[StoredFinding, "open" | "dismissed" | "approved"]>) {
  for (const [f] of items) {
    await pool.query(
      `INSERT INTO findings (id, repo, pr, issue, item, kind, issue_quote, note_quote, note_path, note_date, diff_line, confidence, searches, state, head_sha, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]','open',$13,$14)`,
      [f.id, f.repo, f.pr, f.issue, f.item, f.kind, f.issue_quote, f.note_quote, f.note_path, f.note_date, f.diff_line, f.confidence, f.head_sha, f.created_at],
    );
    const state = items.find(([x]) => x.id === f.id)![1];
    if (state !== "open") await setFindingState(pool, f.id, state);
  }
}

describe("listDismissedForIssue", () => {
  it("returns only dismissed findings for the same repo and issue, with a timestamp", async () => {
    const pool = await makePool();
    const mine = finding({ item: "mine" });
    await seed(pool, [
      [mine, "dismissed"],
      [finding({ item: "other issue", issue: 9 }), "dismissed"],
      [finding({ item: "other repo", repo: "eteen12/elsewhere" }), "dismissed"],
      [finding({ item: "still open" }), "open"],
      [finding({ item: "approved" }), "approved"],
    ]);
    const got = await listDismissedForIssue(pool, "eteen12/demo", 8);
    expect(got.map((f) => f.item)).toEqual(["mine"]);
    expect(Date.parse(got[0].dismissed_at!)).not.toBeNaN();
  });

  it("does not stamp dismissed_at when approving", async () => {
    const pool = await makePool();
    const f = finding();
    await seed(pool, [[f, "approved"]]);
    const { rows } = await pool.query("SELECT dismissed_at FROM findings WHERE id = $1", [f.id]);
    expect(rows[0].dismissed_at).toBeNull();
  });

  it("is unaffected by a later run replacing open findings", async () => {
    const pool = await makePool();
    await seed(pool, [[finding({ item: "kept" }), "dismissed"]]);
    await saveRunFindings(pool, { ...JOB, enqueuedAt: 5000 }, []);
    expect((await listDismissedForIssue(pool, "eteen12/demo", 8)).map((f) => f.item)).toEqual(["kept"]);
  });
});

describe("decisionsMd", () => {
  it("says so when nothing was dismissed", () => {
    expect(decisionsMd([])).toContain("No dismissed findings");
  });

  it("lists item, issue/code said, note said and when", () => {
    const md = decisionsMd([{ ...finding(), dismissed_at: "2026-11-01T10:00:00.000Z" }]);
    expect(md).toContain("## discount");
    expect(md).toContain("Dismissed: 2026-11-01T10:00:00.000Z");
    expect(md).toContain("> Discount is 10%");
    expect(md).toContain("> +const discount = 0.1");
    expect(md).toContain("> Discount is 5%");
    expect(md).toContain("vault/notes/2026-10-28.md, 2026-10-28");
  });

  it("handles no-source findings and a missing timestamp", () => {
    const md = decisionsMd([
      { ...finding({ kind: "no_source", note_quote: null, note_path: null, note_date: null }), dismissed_at: null },
    ]);
    expect(md).toContain("no note");
    expect(md).toContain("Dismissed: unknown");
  });
});

function stubGithub() {
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.endsWith("/graphql")) return json({ data: { repository: { issue: null } } });
    if (u.includes("/parent")) return new Response("", { status: 404 });
    if (u.includes("/comments")) return json([]);
    if (init?.headers?.Accept?.includes("diff")) return new Response("diff --git a b", { status: 200 });
    return json({ number: 8, title: "T", body: "b", state: "open", labels: [], user: null, created_at: "x" });
  });
}

async function runContext(pool: PoolLike): Promise<string> {
  stubGithub();
  const dir = await mkdtemp(join(tmpdir(), "dg-decisions-"));
  scratch.push(dir);
  const ctx = { job: JOB, workspace: { dir, githubDir: dir }, cleanups: [] } as unknown as CheckContext;
  await githubContextStage({ githubToken: "t", pool }).run(ctx);
  return readFile(join(dir, "decisions.md"), "utf8");
}

describe("githubContextStage decisions.md", () => {
  it("writes the dismissed findings for this issue only", async () => {
    const pool = await makePool();
    await seed(pool, [
      [finding({ item: "pricing mismatch" }), "dismissed"],
      [finding({ item: "different issue", issue: 99 }), "dismissed"],
    ]);
    const md = await runContext(pool);
    expect(md).toContain("## pricing mismatch");
    expect(md).not.toContain("different issue");
  });

  it("says no dismissed findings when only other issues have some", async () => {
    const pool = await makePool();
    await seed(pool, [[finding({ item: "different issue", issue: 99 }), "dismissed"]]);
    const md = await runContext(pool);
    expect(md).toContain("No dismissed findings");
    expect(md).not.toContain("different issue");
  });

  it("says no dismissed findings on an empty database", async () => {
    expect(await runContext(await makePool())).toContain("No dismissed findings");
  });
});

describe("agent prompt", () => {
  it("includes the already-settled rule for github/decisions.md (fake Claude echoes its prompt)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dg-prompt-"));
    scratch.push(dir);
    const ctx = { job: JOB, workspace: { dir }, cleanups: [] } as unknown as CheckContext;
    const fake = ["node", fileURLToPath(new URL("../../test/fake-claude.mjs", import.meta.url))];
    process.env.FIXTURE_SCENARIO = "echo";
    try {
      await agentStage({
        promptPath: fileURLToPath(new URL("../../check-prompt.md", import.meta.url)),
        claudeCmd: fake,
      }).run(ctx);
    } finally {
      delete process.env.FIXTURE_SCENARIO;
    }
    const prompt = ctx.agentResult!.finalText;
    expect(prompt).toMatch(/github\/decisions\.md.*already settled/s);
    expect(prompt).toContain("do not report it as a finding");
  });
});
