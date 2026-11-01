import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { findLinkedTask } from "./check/linked-task.js";
import { CheckQueue } from "./check/queue.js";
import { createRunCheck } from "./check/run-check.js";
import { agentStage, githubContextStage, validateStage, workspaceStage } from "./check/stages.js";
import { agentJobPrompt, runAgent } from "./check/agent.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const checkPromptPath = fileURLToPath(new URL("../check-prompt.md", import.meta.url));

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
  ]),
);

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
