import type { CheckJob, RunCheck } from "./queue.js";

/**
 * Per-run state carried through the pipeline. Later leaves add fields:
 * run folder (#11), GitHub context (#12), agent output (#14),
 * validated findings (#15), saved findings (#17).
 */
export interface CheckContext {
  job: CheckJob;
}

export interface CheckStage {
  name: string;
  run: (ctx: CheckContext) => Promise<void>;
}

/**
 * The check pipeline, built stage by stage (one leaf adds one stage).
 * Any stage throwing = failed run; the queue logs it.
 */
export function createRunCheck(stages: CheckStage[]): RunCheck {
  return async (job) => {
    const ctx: CheckContext = { job };
    console.log(`check start ${job.owner}/${job.repo}#${job.prNumber}@${job.headSha} issue=${job.issueNumber}`);
    for (const stage of stages) {
      await stage.run(ctx);
    }
    console.log(`check done ${job.owner}/${job.repo}#${job.prNumber}@${job.headSha}`);
  };
}
