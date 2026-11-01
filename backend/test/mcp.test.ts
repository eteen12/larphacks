import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { API_KEY, REPO, setup } from "./helpers";

type Env = ReturnType<typeof setup>;

/** A real MCP client talking Streamable HTTP to the app's /mcp route, in-process. */
async function connect(env: Env, key: string | null = API_KEY) {
  const transport = new StreamableHTTPClientTransport(new URL("http://drift-guard.test/mcp"), {
    fetch: async (url, init) => env.app.fetch(new Request(url, init)),
    requestInit: { headers: key === null ? {} : { "x-api-key": key } },
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = res.content[0]!.text;
  return { isError: !!res.isError, text, json: res.isError ? undefined : JSON.parse(text) };
}

describe("#31 /mcp route", () => {
  it("lists the four tools", async () => {
    const client = await connect(setup());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["approve", "dismiss", "get_drift", "record_decision"]);
  });

  it.each([
    ["missing", null],
    ["wrong", "nope"],
  ])("refuses the connection with a %s API key", async (_, key) => {
    const env = setup();
    await expect(connect(env, key)).rejects.toMatchObject({ code: 401 });
    const res = await env.app.request("/mcp", { method: "POST", headers: key ? { "x-api-key": key } : {} });
    expect(res.status).toBe(401);
  });
});

describe("#32 get_drift", () => {
  it("returns the issue's findings in the shared shape, open first", async () => {
    const client = await connect(setup());
    const { isError, json } = await call(client, "get_drift", { repo: REPO, issue: 12 });
    expect(isError).toBe(false);
    expect(json.findings.map((f: any) => [f.id, f.state])).toEqual([
      ["d15c0000-0000-4000-8000-000000000001", "open"],
      ["d15c0000-0000-4000-8000-000000000002", "open"],
      ["d15c0000-0000-4000-8000-000000000003", "dismissed"],
    ]);
    expect(Object.keys(json.findings[0]).sort()).toEqual(
      ["id", "repo", "pr", "issue", "item", "kind", "issue_quote", "note_quote", "note_path", "note_date", "diff_line", "confidence", "searches", "state"].sort(),
    );
  });

  it("returns an empty list, not an error, for an issue with no findings", async () => {
    const client = await connect(setup());
    const { isError, json } = await call(client, "get_drift", { repo: REPO, issue: 999 });
    expect(isError).toBe(false);
    expect(json).toEqual({ findings: [] });
  });

  it("makes no GitHub writes", async () => {
    const env = setup();
    await call(await connect(env), "get_drift", { repo: REPO, issue: 12 });
    expect(env.github.calls).toEqual([]);
  });

  it("rejects a malformed repo", async () => {
    const { isError } = await call(await connect(setup()), "get_drift", { repo: "nope", issue: 12 });
    expect(isError).toBe(true);
  });
});

describe("#33 approve, dismiss and record_decision", () => {
  it("approve makes the same GitHub calls and state change as POST /approve", async () => {
    const http = setup();
    const mcp = setup();
    await http.post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: "Change it to 8%", by: "Ethan" });
    const res = await call(await connect(mcp), "approve", { finding_id: "d15c0000-0000-4000-8000-000000000001", instruction: "Change it to 8%", by: "Ethan" });

    expect(res.isError).toBe(false);
    expect(res.json.finding.state).toBe("approved");
    expect(mcp.github.calls).toEqual(http.github.calls);
    expect(mcp.github.calls.map((c) => c.method)).toEqual(["reopenIssue", "commentOnIssue", "commentOnIssue"]);
    expect(mcp.findings.stateChanges).toEqual(http.findings.stateChanges);
  });

  it("dismiss makes the same GitHub calls, state change and re-check as POST /dismiss", async () => {
    const http = setup();
    const mcp = setup();
    await http.post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: "5% confirmed", by: "Ethan" });
    const res = await call(await connect(mcp), "dismiss", { finding_id: "d15c0000-0000-4000-8000-000000000001", note: "5% confirmed", by: "Ethan" });

    expect(res.isError).toBe(false);
    expect(mcp.github.calls).toEqual(http.github.calls);
    expect(mcp.findings.stateChanges).toEqual(http.findings.stateChanges);
    expect(mcp.checks.requests).toEqual(http.checks.requests);
  });

  it("approve and dismiss default By to the MCP agent", async () => {
    const env = setup();
    const client = await connect(env);
    await call(client, "approve", { finding_id: "d15c0000-0000-4000-8000-000000000001", instruction: "fix" });
    await call(client, "dismiss", { finding_id: "d15c0000-0000-4000-8000-000000000002" });
    expect((env.github.calls[1] as any).body).toContain("By: MCP agent, 2026-10-28");
    expect((env.github.calls[3] as any).body).toContain("Decision: Dismissed, no reason given");
    expect((env.github.calls[3] as any).body).toContain("By: MCP agent, 2026-10-28");
  });

  it.each([
    ["approve", { finding_id: "d15c0000-0000-4000-8000-000000000004", instruction: "fix" }, /^409/],
    ["dismiss", { finding_id: "d15c0000-0000-4000-8000-000000000003" }, /^409/],
    ["approve", { finding_id: "d15c0000-0000-4000-8000-000000000001", instruction: "  " }, /^400/],
    ["approve", { finding_id: "nope", instruction: "fix" }, /^404/],
  ])("%s %j → tool error, no writes", async (tool, args, pattern) => {
    const env = setup();
    const res = await call(await connect(env), tool, args);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(pattern);
    expect(env.github.calls).toEqual([]);
  });

  it("GitHub failure → 502 tool error and the finding stays open", async () => {
    const env = setup();
    env.github.failNext("reopenIssue", 500);
    const res = await call(await connect(env), "approve", { finding_id: "d15c0000-0000-4000-8000-000000000001", instruction: "fix" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^502/);
    expect((await env.findings.get("d15c0000-0000-4000-8000-000000000001"))!.state).toBe("open");
  });

  it("record_decision posts the decision format without a finding", async () => {
    const env = setup();
    const res = await call(await connect(env), "record_decision", {
      repo: REPO,
      issue: 15,
      text: "Navy buttons confirmed on the Oct 30 call",
      item: "Brand colour",
      by: "Ethan",
    });
    expect(res.isError).toBe(false);
    expect(res.json.issue_comment).toMatch(/\/issues\/15#issuecomment-/);
    expect(env.github.calls).toEqual([
      {
        method: "commentOnIssue",
        repo: REPO,
        target: 15,
        created: true,
        body: "## Drift decision\nItem: Brand colour\nDecision: Navy buttons confirmed on the Oct 30 call\nBy: Ethan, 2026-10-28\nFinding: none",
      },
    ]);
    expect(env.findings.stateChanges).toEqual([]);
  });

  it("record_decision: empty text → 400, unknown issue → 404, GitHub failure → 502", async () => {
    const env = setup();
    const client = await connect(env);
    expect((await call(client, "record_decision", { repo: REPO, issue: 15, text: " " })).text).toMatch(/^400/);
    expect((await call(client, "record_decision", { repo: REPO, issue: 999, text: "x" })).text).toMatch(/^404/);
    env.github.failNext("commentOnIssue", 500);
    expect((await call(client, "record_decision", { repo: REPO, issue: 15, text: "x" })).text).toMatch(/^502/);
  });
});
