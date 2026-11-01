import type { CheckStage } from "./run-check.js";
import type { GitHubWriter } from "../actions/github.js";

/**
 * #20 — the drift-guard commit status. Context is fixed inside github.ts.
 * Status failures are logged, never thrown: a missing status blocks the PR
 * through branch protection anyway, and the check itself is more valuable
 * than dying on a status-write blip.
 */
export function statusStartStage(deps: { github: GitHubWriter }): CheckStage {
  return {
    name: "status-start",
    async run(ctx) {
      const repo = `${ctx.job.owner}/${ctx.job.repo}`;
      try {
        await deps.github.setCommitStatus(repo, ctx.job.headSha, "pending", "Drift check running");
      } catch (err) {
        console.error(`drift-guard pending status failed for ${repo}@${ctx.job.headSha}`, err);
      }
    },
  };
}

/** Final status — open findings fail, none pass, a failed run is an error. */
export function statusStage(deps: { github: GitHubWriter }): CheckStage {
  return {
    name: "status",
    async run(ctx) {
      if (ctx.discarded) return; // the newer head reports on its own sha
      const repo = `${ctx.job.owner}/${ctx.job.repo}`;
      let state: "success" | "failure" | "error";
      let description: string;
      if (ctx.error) {
        state = "error";
        description = "Drift check failed, see comment";
      } else {
        // Findings saved by this run are all open; approved/dismissed rows
        // from earlier runs are not part of ctx.findings.
        const open = ctx.findings?.length ?? 0;
        state = open > 0 ? "failure" : "success";
        description = open > 0 ? `${open} drift finding${open === 1 ? "" : "s"}, see comment` : "No drift found";
      }
      try {
        await deps.github.setCommitStatus(repo, ctx.job.headSha, state, description);
      } catch (err) {
        console.error(`drift-guard ${state} status failed for ${repo}@${ctx.job.headSha}`, err);
      }
    },
  };
}
