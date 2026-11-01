import { Hono } from "hono";
import type { ActionDeps } from "./actions/decisions";
import { createActionRoutes } from "./actions/routes";
import { createMcpRoute } from "./mcp/server";

export function createApp(deps: ActionDeps, opts: { apiKey: string }): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", createActionRoutes(deps, opts.apiKey));
  app.route("/", createMcpRoute(deps, opts.apiKey));
  return app;
}
