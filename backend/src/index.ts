import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { findLinkedTask } from "./check/linked-task.js";
import { CheckQueue } from "./check/queue.js";
import { createRunCheck } from "./check/run-check.js";
import { agentStage, githubContextStage, saveStage, validateStage, workspaceStage } from "./check/stages.js";
import { agentJobPrompt, runAgent } from "./check/agent.js";
import { migrate, type PoolLike } from "./check/store.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const checkPromptPath = fileURLToPath(new URL("../check-prompt.md", import.meta.url));

// No DATABASE_URL -> save stage throws inside the run = failed run, never "no drift".
const pool: PoolLike = env.databaseUrl
  ? new pg.Pool({ connectionString: env.databaseUrl })
  : {
      query: () => Promise.reject(new Error("DATABASE_URL is not set")),
      connect: () => Promise.reject(new Error("DATABASE_URL is not set")),
    };

if (env.databaseUrl) {
  await migrate(pool).catch((err) => {
    console.error("database migration failed", err);
    process.exit(1);
  });
}

const queue = new CheckQueue(
  createRunCheck([
    workspaceStage({ githubToken: env.githubToken, vaultRepo: env.vaultRepo }),
    githubContextStage({ githubToken: env.githubToken }),
    agentStage({ promptPath: checkPromptPath }),
    validateStage({
      rerunWithError: async (ctx, error) =>
        runAgent({
          prompt: agentJobPrompt(
            await readFile(checkPromptPath, "utf8"),
            ctx.job,
          ) + `\n\nYour previous answer failed validation: ${error}\nReturn only the corrected JSON.`,
          cwd: ctx.workspace!.dir,
        }),
    }),
    saveStage({ pool }),
  ]),
);

const app = createApp({
  webhook: {
    webhookSecret: env.githubWebhookSecret,
    queue,
    resolveLinkedTask: (pr) => findLinkedTask(env.githubToken, pr),
  },
  findings: { pool, apiKey: env.findingsApiKey, frontendOrigin: env.frontendOrigin },
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`drift-guard backend listening on :${info.port}`);
});
