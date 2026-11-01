// The HTTP clients for #18's findings API and #9's POST /checks, used once those land.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createChecksApi, FakeCheckRequester } from "../src/actions/checks";
import { approveFinding } from "../src/actions/decisions";
import { DEMO_REPO, fixtureFindings } from "../src/actions/fixtures";
import { createFindingsApiStore, FindingsStoreError } from "../src/actions/findings-store";
import { FakeGitHub } from "../src/actions/github.fake";

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; method: string; headers: any; body?: any }[] = [];
  const doFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, doFetch };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("findings API store", () => {
  it("GET /findings/:id with the API key, without listing when the route exists", async () => {
    const { calls, doFetch } = recordingFetch(() => json(200, fixtureFindings[0]));
    const store = createFindingsApiStore({ baseUrl: "http://api/", apiKey: "k", fetch: doFetch });
    expect((await store.get("f-discount"))!.id).toBe("f-discount");
    expect(calls).toHaveLength(999);
    expect(calls[0]).toMatchObject({ url: "http://api/findings/f-discount", method: "GET", headers: { "x-api-key": "k" } });
  });

  // #18 has no GET /findings/:id, so Hono answers with its default plain-text 404.
  const honoNotFound = () => new Response("404 Not Found", { status: 404 });

  it("falls back to GET /findings when GET /findings/:id is a 404", async () => {
    const { calls, doFetch } = recordingFetch((url) => (url.endsWith("/findings") ? json(200, fixtureFindings) : honoNotFound()));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    expect((await store.get("f-deposit"))!.id).toBe("f-deposit");
    expect(calls).toMatchObject([
      { url: "http://api/findings/f-deposit", method: "GET", headers: { "x-api-key": "k" } },
      { url: "http://api/findings", method: "GET", headers: { "x-api-key": "k" } },
    ]);
  });

  it("returns null when the id is in neither GET /findings/:id nor GET /findings", async () => {
    const { calls, doFetch } = recordingFetch((url) => (url.endsWith("/findings") ? json(200, fixtureFindings) : honoNotFound()));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    expect(await store.get("nope")).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("throws on a 401 from GET /findings/:id without falling back", async () => {
    const { calls, doFetch } = recordingFetch(() => json(401, { error: "unauthorized" }));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "wrong", fetch: doFetch });
    await expect(store.get("f-discount")).rejects.toMatchObject({ name: "FindingsStoreError", status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("throws with the status when the fallback GET /findings fails", async () => {
    const { doFetch } = recordingFetch((url) => (url.endsWith("/findings") ? json(500, {}) : honoNotFound()));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    const err = await store.get("f-discount").catch((e) => e);
    expect(err).toBeInstanceOf(FindingsStoreError);
    expect(err.status).toBe(500);
  });

  it("returns null for ids that would escape /findings/, without any request", async () => {
    const { calls, doFetch } = recordingFetch(() => json(200, fixtureFindings));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    for (const id of ["", ".", ".."]) expect(await store.get(id)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("PATCH /findings/:id/state, throwing with the status on failure", async () => {
    let status = 200;
    const { calls, doFetch } = recordingFetch(() => json(status, {}));
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    await store.setState("f1", "approved");
    expect(calls[0]).toMatchObject({ url: "http://api/findings/f1/state", method: "PATCH", body: { state: "approved" } });
    status = 500;
    await expect(store.setState("f1", "approved")).rejects.toBeInstanceOf(FindingsStoreError);
  });

  it("listByIssue filters GET /findings by repo and issue (array or {findings})", async () => {
    for (const payload of [fixtureFindings, { findings: fixtureFindings }]) {
      const { doFetch } = recordingFetch(() => json(200, payload));
      const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
      expect((await store.listByIssue("demo-org/demo-shop", 12)).map((f) => f.id)).toEqual(["f-discount", "f-deposit", "f-old"]);
    }
  });
});

describe("against a mock of #18's real findings API", () => {
  // Mirrors drift-check's findings-api.ts: sub-app at /findings, x-api-key gate, GET / returns a plain
  // array with extra fields, PATCH /:id/state, and no GET /:id route.
  function mockFindingsApi(apiKey: string) {
    const rows = fixtureFindings.map((f) => ({ ...f, head_sha: "abc123", created_at: "2026-10-28T14:00:00Z" }));
    const patches: { id: string; body: unknown }[] = [];
    const findings = new Hono();
    findings.use("*", async (c, next) => {
      if (c.req.header("x-api-key") !== apiKey) return c.json({ error: "unauthorized" }, 401);
      await next();
    });
    findings.get("/", (c) => {
      const state = c.req.query("state");
      return c.json(state ? rows.filter((r) => r.state === state) : rows);
    });
    findings.patch("/:id/state", async (c) => {
      const body = await c.req.json();
      patches.push({ id: c.req.param("id"), body });
      if (body.state !== "approved" && body.state !== "dismissed") return c.json({ error: "bad state" }, 400);
      const row = rows.find((r) => r.id === c.req.param("id"));
      if (!row) return c.json({ error: "not found" }, 404);
      row.state = body.state;
      return c.json({ ok: true });
    });
    const app = new Hono().route("/findings", findings);
    return { app, rows, patches };
  }

  it("approveFinding succeeds end to end", async () => {
    const api = mockFindingsApi("k");
    const store = createFindingsApiStore({ baseUrl: "http://api", apiKey: "k", fetch: ((url: string, init?: RequestInit) => api.app.fetch(new Request(url, init))) as typeof fetch });
    const github = new FakeGitHub().addIssue(DEMO_REPO, 12, "closed").addIssue(DEMO_REPO, 40, "open");
    const checks = new FakeCheckRequester();

    const result = await approveFinding({ github, findings: store, checks }, { findingId: "f-discount", instruction: "Use 8%." });

    expect(result).toMatchObject({ ok: true, body: { finding: { id: "f-discount", state: "approved" } } });
    expect(api.patches).toEqual([{ id: "f-discount", body: { state: "approved" } }]);
    expect(api.rows.find((r) => r.id === "f-discount")!.state).toBe("approved");
    expect(github.issueState(DEMO_REPO, 12)).toBe("open");
  });
});

describe("checks API", () => {
  it("POST /checks { repo, pr }, throwing on failure", async () => {
    let status = 202;
    const { calls, doFetch } = recordingFetch(() => json(status, {}));
    const checks = createChecksApi({ baseUrl: "http://api", apiKey: "k", fetch: doFetch });
    await checks.requestCheck("demo-org/demo-shop", 40);
    expect(calls[0]).toMatchObject({ url: "http://api/checks", method: "POST", body: { repo: "demo-org/demo-shop", pr: 40 } });
    status = 503;
    await expect(checks.requestCheck("demo-org/demo-shop", 40)).rejects.toThrow(/503/);
  });
});
