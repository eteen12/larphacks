import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { findLinkedTask } from "./check/linked-task.js";
import { CheckQueue } from "./check/queue.js";
import { createRunCheck } from "./check/run-check.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

const queue = new CheckQueue(createRunCheck([]));

const app = createApp({
  webhook: {
    webhookSecret: env.githubWebhookSecret,
    queue,
    resolveLinkedTask: (pr) => findLinkedTask(env.githubToken, pr),
  },
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`drift-guard backend listening on :${info.port}`);
});
