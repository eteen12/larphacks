import type { AgentResult } from "./agent.js";
import type { CheckJob, RunCheck } from "./queue.js";
import type { Workspace } from "./workspace.js";
import type { StoredFinding } from "../../../shared/finding.js";

/**
 * Per-run state carried through the pipeline. Later leaves add fields:
 * saved findings (#17).
 */
export interface CheckContext {
  job: CheckJob;
  workspace?: Workspace;
  agentResult?: AgentResult;
  findings?: StoredFinding[];
  /** Registered by stages; run in reverse order when the run ends, success or failure. */
  cleanups: Array<() => Promise<void>>;
}

export interface CheckStage {
  name: string;
  run: (ctx: CheckContext) => Promise<void>;
}

/**
 * The check pipeline, built stage by stage (one leaf adds one stage).
 * Any stage throwing = failed run; the queue logs it. Cleanups always run.
 */
export function createRunCheck(stages: CheckStage[]): RunCheck {
  return async (job) => {
    const ctx: CheckContext = { job, cleanups: [] };
    const key = `${job.owner}/${job.repo}#${job.prNumber}@${job.headSha}`;
    console.log(`check start ${key} issue=${job.issueNumber}`);
    try {
      for (const stage of stages) {
        await stage.run(ctx);
      }
      console.log(`check done ${key}`);
    } finally {
      for (const cleanup of ctx.cleanups.reverse()) {
        await cleanup().catch((err) => console.error(`cleanup failed for ${key}`, err));
      }
    }
  };
}
