// The HTTP client for #9's POST /checks (#52 removes it with the dismiss re-check).
import { describe, expect, it } from "vitest";
import { createChecksApi } from "../src/actions/checks";

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; method: string; headers: any; body?: any }[] = [];
  const doFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, doFetch };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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
