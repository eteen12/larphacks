import { Hono } from "hono";
import type { ActionDeps } from "./actions/decisions";
import { createActionRoutes } from "./actions/routes";
import { githubWebhookHandler, type WebhookDeps } from "./check/webhook.js";
import { findingsApi, type FindingsApiDeps } from "./check/findings-api.js";
import { createMcpRoute } from "./mcp/server";

export interface AppDeps {
  /** POST /webhooks/github (drift check). */
  webhook?: WebhookDeps;
  /** GET /findings and PATCH /findings/:id/state, read from Postgres. */
  findingsApi?: FindingsApiDeps;
  /** POST /findings/:id/approve|dismiss and /mcp. Needs apiKey. */
  actions?: ActionDeps;
  apiKey?: string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  if (deps.webhook) app.post("/webhooks/github", githubWebhookHandler(deps.webhook));
  // Mounted before the action routes so its CORS handling covers approve/dismiss too.
  if (deps.findingsApi) app.route("/findings", findingsApi(deps.findingsApi));
  if (deps.actions) {
    const apiKey = deps.apiKey ?? "";
    app.route("/", createActionRoutes(deps.actions, apiKey));
    app.route("/", createMcpRoute(deps.actions, apiKey));
  }

  return app;
}
