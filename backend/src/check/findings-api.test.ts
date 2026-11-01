import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { Hono } from "hono";
import { findingsApi } from "./findings-api.js";
import { migrate, saveRunFindings, type PoolLike } from "./store.js";
import type { StoredFinding } from "../../../shared/finding.js";

function makeApp() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as PoolLike;
  const app = new Hono().route(
    "/findings",
    findingsApi({ pool, apiKey: "secret-key", frontendOrigin: "https://inbox.example" }),
  );
  return { app, pool };
}

const seed = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: crypto.randomUUID(),
  repo: "o/r",
  pr: 1,
  issue: 2,
  item: "x",
  kind: "conflict",
  issue_quote: "q",
  note_quote: "n",
  note_path: "p",
  note_date: "d",
  diff_line: "+l",
  confidence: 0.9,
  searches: [],
  state: "open",
  head_sha: "s",
  created_at: new Date().toISOString(),
  ...over,
});

const job = { owner: "o", repo: "r", prNumber: 1, headSha: "s", issueNumber: 2, enqueuedAt: 1 };

const AUTH = { "x-api-key": "secret-key" };

describe("findings API", () => {
  it("GET /findings returns newest first and honors ?state=open", async () => {
    const { app, pool } = makeApp();
    await migrate(pool);
    const old = seed({ created_at: new Date(1000).toISOString() });
    const fresh = seed({ created_at: new Date(2000).toISOString() });
    await saveRunFindings(pool, job, [old, fresh]);
    await pool.query("UPDATE findings SET state = 'dismissed' WHERE id = $1", [old.id]);

    const all = await app.request("/findings", { headers: AUTH });
    expect(all.status).toBe(200);
    const items = (await all.json()) as StoredFinding[];
    expect(items[0].id).toBe(fresh.id); // newest first

    const open = await app.request("/findings?state=open", { headers: AUTH });
    expect(((await open.json()) as StoredFinding[]).map((f) => f.id)).toEqual([fresh.id]);
  });

  it("rejects missing and wrong API keys with 401", async () => {
    const { app, pool } = makeApp();
    await migrate(pool);
    expect((await app.request("/findings")).status).toBe(401);
    const bad = await app.request("/findings", { headers: { "x-api-key": "nope" } });
    expect(bad.status).toBe(401);
  });

  it("PATCH sets state to approved/dismissed only; 404 unknown id; 400 bad state", async () => {
    const { app, pool } = makeApp();
    await migrate(pool);
    const f = seed();
    await saveRunFindings(pool, job, [f]);

    const ok = await app.request(`/findings/${f.id}/state`, {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ state: "approved" }),
    });
    expect(ok.status).toBe(200);
    expect((await pool.query("SELECT state FROM findings WHERE id = $1", [f.id])).rows[0].state).toBe(
      "approved",
    );

    const notFound = await app.request(`/findings/${crypto.randomUUID()}/state`, {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ state: "dismissed" }),
    });
    expect(notFound.status).toBe(404);

    for (const state of ["open", "banana", 3]) {
      const bad = await app.request(`/findings/${f.id}/state`, {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      expect(bad.status).toBe(400);
    }
  });

  it("PATCH requires the API key too", async () => {
    const { app, pool } = makeApp();
    await migrate(pool);
    const res = await app.request(`/findings/${crypto.randomUUID()}/state`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "approved" }),
    });
    expect(res.status).toBe(401);
  });

  it("CORS allows only the frontend origin", async () => {
    const { app, pool } = makeApp();
    await migrate(pool);
    const good = await app.request("/findings", {
      headers: { ...AUTH, origin: "https://inbox.example" },
    });
    expect(good.headers.get("access-control-allow-origin")).toBe("https://inbox.example");
    const evil = await app.request("/findings", {
      headers: { ...AUTH, origin: "https://evil.example" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});
