import { Hono } from "hono";
import type { ActionDeps } from "./actions/decisions";
import { createActionRoutes } from "./actions/routes";

export function createApp(deps: ActionDeps, opts: { apiKey: string }): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", createActionRoutes(deps, opts.apiKey));
  return app;
}
