// The HTTP clients for #18's findings API and #9's POST /checks, used once those land.
import { describe, expect, it } from "vitest";
import { createChecksApi } from "../src/actions/checks";
import { fixtureFindings } from "../src/actions/fixtures";
import { createFindingsApiStore, FindingsStoreError } from "../src/actions/findings-store";

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
  it("GET /findings/:id with the API key; 404 → null", async () => {
    const { calls, doFetch } = recordingFetch((url) => (url.endsWith("/f-discount") ? json(200, fixtureFindings[0]) : json(404, {})));
    const store = createFindingsApiStore({ baseUrl: "http://api/", apiKey: "k", fetch: doFetch });
    expect((await store.get("f-discount"))!.id).toBe("f-discount");
    expect(await store.get("nope")).toBeNull();
    expect(calls[0]).toMatchObject({ url: "http://api/findings/f-discount", method: "GET", headers: { "x-api-key": "k" } });
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
