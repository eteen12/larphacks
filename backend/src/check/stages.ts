import type { CheckStage } from "./run-check.js";
import { createWorkspace, destroyWorkspace, type WorkspaceDeps } from "./workspace.js";
import { writeGithubContext } from "./github-context.js";

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
