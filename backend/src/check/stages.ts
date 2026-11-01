import { readFile } from "node:fs/promises";
import type { CheckStage } from "./run-check.js";
import { createWorkspace, destroyWorkspace, type WorkspaceDeps } from "./workspace.js";
import { writeGithubContext } from "./github-context.js";
import { agentJobPrompt, runAgent } from "./agent.js";

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
