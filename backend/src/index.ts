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
import { commentStage } from "./check/pr-comment.js";
import { statusStage, statusStartStage } from "./check/status.js";
import { migrate, type PoolLike } from "./check/store.js";
import { createGitHub, type GitHubWriter } from "./actions/github.js";
import { createDbFindingsStore } from "./actions/findings-store.js";
import { ConfigError, loadEnv, postgresConfig, type Env } from "./env.js";

let env: Env;
try {
  const loaded = loadEnv();
  env = loaded.env;
  if (loaded.warning) console.warn(loaded.warning);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`${err.message}\nSet it in the environment (see backend/.env.example) and restart.`);
  process.exit(1);
}
const checkPromptPath = fileURLToPath(new URL("../check-prompt.md", import.meta.url));

// Production always has a DATABASE_URL (loadEnv refuses otherwise). Locally, without one the
// save stage throws inside the run = failed run, never "no drift".
const pool: PoolLike = env.databaseUrl
  ? new pg.Pool(postgresConfig(env.databaseUrl))
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

// Local dev only: the write token may fall back to the read token, and with neither the writer
// throws on use. In production loadEnv has already required GITHUB_WRITE_TOKEN.
const writeToken = env.githubWriteToken || env.githubToken;
const github: GitHubWriter = writeToken
  ? createGitHub({ token: writeToken })
  : {
      reopenIssue: () => Promise.reject(new Error("GITHUB_WRITE_TOKEN is not set")),
      commentOnIssue: () => Promise.reject(new Error("GITHUB_WRITE_TOKEN is not set")),
      upsertPrComment: () => Promise.reject(new Error("GITHUB_WRITE_TOKEN is not set")),
      setCommitStatus: () => Promise.reject(new Error("GITHUB_WRITE_TOKEN is not set")),
    };

const queue = new CheckQueue(
  createRunCheck([
    statusStartStage({ github }),
    workspaceStage({ githubToken: env.githubToken, vaultRepo: env.vaultRepo }),
    githubContextStage({ githubToken: env.githubToken, pool }),
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
  ], [
    commentStage({ github }),
    statusStage({ github }),
  ]),
);

// Approve/dismiss/MCP read and update findings straight from the database.
const findingsStore = createDbFindingsStore(pool);

const app = createApp({
  webhook: {
    webhookSecret: env.githubWebhookSecret,
    queue,
    resolveLinkedTask: (pr) => findLinkedTask(env.githubToken, pr),
  },
  findingsApi: { pool, apiKey: env.findingsApiKey, frontendOrigin: env.frontendOrigin },
  actions: { github, findings: findingsStore },
  apiKey: env.findingsApiKey,
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`drift-guard backend listening on :${info.port}`);
});
