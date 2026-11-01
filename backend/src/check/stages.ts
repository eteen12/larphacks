import type { CheckStage } from "./run-check.js";
import { createWorkspace, destroyWorkspace, type WorkspaceDeps } from "./workspace.js";

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
