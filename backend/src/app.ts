import { Hono } from "hono";
import { githubWebhookHandler, type WebhookDeps } from "./check/webhook.js";
import { findingsApi, type FindingsApiDeps } from "./check/findings-api.js";

export interface AppDeps {
  webhook: WebhookDeps;
  findings?: FindingsApiDeps;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/webhooks/github", githubWebhookHandler(deps.webhook));
  if (deps.findings) {
    app.route("/findings", findingsApi(deps.findings));
  }

  return app;
}
