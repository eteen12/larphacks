// /mcp route on the app server (#31): get_drift, record_decision, approve, dismiss.
// Tools call the same functions as the HTTP routes and make no drift judgements.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "zod";
import { requireApiKey } from "../actions/auth";
import { approveFinding, dismissFinding, recordDecision, type ActionDeps, type ActionResult } from "../actions/decisions";
import type { Finding } from "../finding";

const repoSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name").describe("Repository as owner/name");

function toToolResult<T>(result: ActionResult<T>): CallToolResult {
  if (!result.ok) return { isError: true, content: [{ type: "text", text: `${result.status}: ${result.error}` }] };
  return { content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }] };
}

/** Open findings first; otherwise keep the store's order. */
export function sortOpenFirst(findings: Finding[]): Finding[] {
  return findings.map((f, i) => ({ f, i })).sort((a, b) => Number(b.f.state === "open") - Number(a.f.state === "open") || a.i - b.i).map((x) => x.f);
}

export function createMcpServer(deps: ActionDeps): McpServer {
  const server = new McpServer({ name: "drift-guard", version: "0.1.0" });

  server.registerTool(
    "get_drift",
    {
      description: "List Drift guard findings for a GitHub issue, open findings first.",
      inputSchema: { repo: repoSchema, issue: z.number().int().positive().describe("Issue number") },
      annotations: { readOnlyHint: true },
    },
    async ({ repo, issue }) => toToolResult({ ok: true, body: { findings: sortOpenFirst(await deps.findings.listByIssue(repo, issue)) } }),
  );

  server.registerTool(
    "record_decision",
    {
      description: "Post a '## Drift decision' comment on an issue without a finding, so future checks treat it as settled.",
      inputSchema: {
        repo: repoSchema,
        issue: z.number().int().positive(),
        text: z.string().describe("The decision, e.g. '5% confirmed by the client on the Oct 30 call'"),
        item: z.string().optional().describe("What the decision is about"),
        by: z.string().optional().describe("Who made the decision"),
      },
    },
    async (args) => toToolResult(await recordDecision(deps, args)),
  );

  server.registerTool(
    "approve",
    {
      description: "Approve a finding: reopen its issue, record the decision, and ask @claude on the PR to fix it.",
      inputSchema: {
        finding_id: z.string(),
        instruction: z.string().describe("What the fix should do"),
        by: z.string().optional(),
      },
    },
    async ({ finding_id, instruction, by }) => toToolResult(await approveFinding(deps, { findingId: finding_id, instruction, by: by ?? "MCP agent" })),
  );

  server.registerTool(
    "dismiss",
    {
      description: "Dismiss a finding as not drift. Posts nothing on GitHub; when it was the PR's last open finding, the PR's drift-guard status turns green.",
      inputSchema: { finding_id: z.string(), note: z.string().optional(), by: z.string().optional() },
    },
    async ({ finding_id, note, by }) => toToolResult(await dismissFinding(deps, { findingId: finding_id, note, by: by ?? "MCP agent" })),
  );

  return server;
}

export function createMcpRoute(deps: ActionDeps, apiKey: string): Hono {
  const app = new Hono();
  app.use("/mcp", requireApiKey(apiKey));
  // Stateless: a fresh server and transport per request.
  app.all("/mcp", async (c) => {
    const server = createMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return app;
}
