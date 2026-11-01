import { readFile } from "node:fs/promises";
import type { CheckContext, CheckStage } from "./run-check.js";
import { createWorkspace, destroyWorkspace, type WorkspaceDeps } from "./workspace.js";
import { writeGithubContext } from "./github-context.js";
import { agentJobPrompt, runAgent, type AgentResult } from "./agent.js";
import { buildFindings, parseCheckOutput } from "./validate.js";
import { saveRunFindings, type PoolLike } from "./store.js";

/** #11 — clone the PR code and the vault into a per-run folder, removed when the run ends. */
export function workspaceStage(deps: WorkspaceDeps): CheckStage {
  return {
    name: "workspace",
    async run(ctx) {
      ctx.workspace = await createWorkspace(deps, ctx.job);
      ctx.cleanups.push(() => destroyWorkspace(ctx.workspace!));
    },
  };
}

/** #12 — write issue.md, parents.md, board.md, pr.md and diff.patch for the agent. */
export function githubContextStage(deps: { githubToken: string }): CheckStage {
  return {
    name: "github-context",
    async run(ctx) {
      if (!ctx.workspace) throw new Error("github-context stage needs the workspace stage first");
      await writeGithubContext(deps.githubToken, ctx.workspace.githubDir, ctx.job);
    },
  };
}

/** #14 — run `claude -p` read-only on the run folder; prompt read fresh each run. */
export function agentStage(deps: { promptPath: string; timeoutMs?: number }): CheckStage {
  return {
    name: "agent",
    async run(ctx) {
      if (!ctx.workspace) throw new Error("agent stage needs the workspace stage first");
      const prompt = await readFile(deps.promptPath, "utf8");
      ctx.agentResult = await runAgent({
        prompt: agentJobPrompt(prompt, ctx.job),
        cwd: ctx.workspace.dir,
        timeoutMs: deps.timeoutMs,
      });
    },
  };
}

/** #15 — validate the agent's 3-part output into findings; one retry, then failed run. */
export function validateStage(deps: {
  rerunWithError: (ctx: CheckContext, error: string) => Promise<AgentResult>;
}): CheckStage {
  return {
    name: "validate",
    async run(ctx) {
      if (!ctx.agentResult) throw new Error("validate stage needs the agent stage first");
      let output;
      try {
        output = parseCheckOutput(ctx.agentResult.finalText);
      } catch (err) {
        const second = await deps.rerunWithError(ctx, (err as Error).message);
        output = parseCheckOutput(second.finalText); // throws on second failure -> failed run
      }
      ctx.findings = buildFindings(output, ctx.job, ctx.agentResult.searches);
    },
  };
}

/** #17 — persist the run's findings atomically; a stale run saves nothing. */
export function saveStage(deps: { pool: PoolLike }): CheckStage {
  return {
    name: "save",
    async run(ctx) {
      if (!ctx.findings) throw new Error("save stage needs the validate stage first");
      const result = await saveRunFindings(deps.pool, ctx.job, ctx.findings);
      if (result === "discarded") {
        console.log(`save discarded: newer run already finished for ${ctx.job.repo}#${ctx.job.prNumber}`);
      }
    },
  };
}
