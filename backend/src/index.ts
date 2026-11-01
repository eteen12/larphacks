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
import { FakeCheckRequester } from "./actions/checks.js";
import { createDbFindingsStore } from "./actions/findings-store.js";
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

// Write token falls back to the read token; with neither, the writer throws on
// use and reporters log the failure without crashing the run.
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
  ], [
    commentStage({ github }),
    statusStage({ github }),
  ]),
);

if (!env.findingsApiKey) throw new Error("FINDINGS_API_KEY is not set");

// Approve/dismiss/MCP read and update findings straight from the database.
const findingsStore = createDbFindingsStore(pool);

// INTEGRATION TODO (#52): dismiss still asks for a re-check via POST /checks, which does not
// exist here. Recorded in memory only, nothing re-runs. #52 removes the re-check from dismiss.
const checkRequester = new FakeCheckRequester();

const app = createApp({
  webhook: {
    webhookSecret: env.githubWebhookSecret,
    queue,
    resolveLinkedTask: (pr) => findLinkedTask(env.githubToken, pr),
  },
  findingsApi: { pool, apiKey: env.findingsApiKey, frontendOrigin: env.frontendOrigin },
  actions: { github, findings: findingsStore, checks: checkRequester },
  apiKey: env.findingsApiKey,
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`drift-guard backend listening on :${info.port}`);
});
