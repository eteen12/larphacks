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
  /** Set when a pipeline stage threw — reporters branch on it. */
  error?: Error;
  /** Set when the save stage discarded this run as stale — reporters skip. */
  discarded?: boolean;
  /** Registered by stages; run in reverse order when the run ends, success or failure. */
  cleanups: Array<() => Promise<void>>;
}

export interface CheckStage {
  name: string;
  run: (ctx: CheckContext) => Promise<void>;
}

/**
 * The check pipeline, built stage by stage (one leaf adds one stage).
 * A stage throwing = failed run: ctx.error is set and reporters still run so
 * the PR is told "check failed" rather than left silent. Cleanups always run.
 */
export function createRunCheck(stages: CheckStage[], reporters: CheckStage[] = []): RunCheck {
  return async (job) => {
    const ctx: CheckContext = { job, cleanups: [] };
    const key = `${job.owner}/${job.repo}#${job.prNumber}@${job.headSha}`;
    console.log(`check start ${key} issue=${job.issueNumber}`);
    try {
      for (const stage of stages) {
        await stage.run(ctx);
      }
      if (!ctx.error) console.log(`check done ${key}`);
    } catch (err) {
      ctx.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      for (const cleanup of ctx.cleanups.reverse()) {
        await cleanup().catch((err) => console.error(`cleanup failed for ${key}`, err));
      }
    }
    for (const reporter of reporters) {
      await reporter.run(ctx).catch((err) => console.error(`reporter ${reporter.name} failed for ${key}`, err));
    }
    if (ctx.error) throw ctx.error;
  };
}
