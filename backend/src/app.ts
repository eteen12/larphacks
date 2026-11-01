import { Hono } from "hono";
import { githubWebhookHandler, type WebhookDeps } from "./check/webhook.js";

export interface AppDeps {
  webhook: WebhookDeps;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/webhooks/github", githubWebhookHandler(deps.webhook));

  return app;
}
