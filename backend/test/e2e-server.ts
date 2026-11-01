// TEST ONLY. Backend for the browser test (e2e/): the real app, routes, DB store and findings API
// over real Postgres, with the in-memory FakeGitHub instead of GitHub and no agent/Claude at all.
// Adds /__e2e/* control routes so the test can reset state and read what the fake GitHub received.
// Never imported by src/ and never started in production (it refuses NODE_ENV=production).
// Run: DATABASE_URL=... FINDINGS_API_KEY=... FRONTEND_ORIGIN=... npx tsx test/e2e-server.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import pg from "pg";
import { createApp } from "../src/app";
import { createDbFindingsStore } from "../src/actions/findings-store";
import { FakeGitHub, type FakeMethod } from "../src/actions/github.fake";
import { migrate, type PoolLike } from "../src/check/store";
import { loadEnv, postgresConfig } from "../src/env";
import type { ActionDeps } from "../src/actions/decisions";

if (process.env.NODE_ENV === "production") throw new Error("e2e-server must never run in production");
const { env } = loadEnv();
if (!env.databaseUrl) throw new Error("DATABASE_URL is required");

const REPO = "demo-org/demo-shop";
const HEAD_SHA = "abc123";
const pool = new pg.Pool(postgresConfig(env.databaseUrl)) as unknown as PoolLike;
await migrate(pool);

function freshGitHub() {
  return new FakeGitHub().addIssue(REPO, 12, "closed").addIssue(REPO, 40, "open").addCommit(REPO, HEAD_SHA);
}

const deps: ActionDeps = { github: freshGitHub(), findings: createDbFindingsStore(pool) };
const fake = () => deps.github as FakeGitHub;

const ID = "d15c0000-0000-4000-8000-000000000001";

async function seed() {
  await pool.query("DELETE FROM findings");
  await pool.query(
    `INSERT INTO findings (id, repo, pr, issue, item, kind, issue_quote, note_quote, note_path, note_date, diff_line, confidence, searches, state, head_sha)
     VALUES ($1,$2,40,12,'Slow-season discount','conflict',
       'Apply a 10% slow-season discount from November to February.',
       'Let''s make the slow-season discount 8%, not 5%.',
       'meetings/2026-10-28 call.md','2026-10-28','src/discount.ts:14 + const SLOW_SEASON_DISCOUNT = 0.10;',
       0.92,'["slow-season discount"]','open',$3)`,
    [ID, REPO, HEAD_SHA],
  );
}

const control = new Hono();
control.post("/reset", async (c) => {
  deps.github = freshGitHub();
  await seed();
  return c.json({ id: ID, repo: REPO, pr: 40, issue: 12, sha: HEAD_SHA });
});
control.post("/fail-next", async (c) => {
  const { method, status } = (await c.req.json()) as { method: FakeMethod; status?: number };
  fake().failNext(method, status ?? 500);
  return c.json({ ok: true });
});
control.get("/state", async (c) => {
  const { rows } = await pool.query("SELECT id, state FROM findings");
  return c.json({
    findings: rows,
    calls: fake().calls,
    statuses: fake().statuses,
    issueState: fake().issueState(REPO, 12),
    issueComments: fake().comments(REPO, 12).map((x) => x.body),
    prComments: fake().comments(REPO, 40).map((x) => x.body),
  });
});

const app = createApp({
  findingsApi: { pool, apiKey: env.findingsApiKey, frontendOrigin: env.frontendOrigin },
  actions: deps,
  apiKey: env.findingsApiKey,
});
app.route("/__e2e", control);

await seed();
serve({ fetch: app.fetch, port: env.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`e2e backend (fake GitHub) listening on :${info.port}`);
});
