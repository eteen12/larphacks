export interface CheckJob {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  issueNumber: number;
}

export type RunCheck = (job: CheckJob) => Promise<void>;

/**
 * Serial check runner: one check at a time, one check per (PR, head SHA),
 * one check per webhook delivery. A newer head for the same PR marks older
 * runs stale so their results are discarded when they finish.
 */
export class CheckQueue {
  private readonly seenDeliveries = new Set<string>();
  private readonly seenHeads = new Set<string>();
  private readonly latestHead = new Map<string, string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly runCheck: RunCheck) {}

  private prKey(job: CheckJob): string {
    return `${job.owner}/${job.repo}#${job.prNumber}`;
  }

  enqueue(deliveryId: string, job: CheckJob): "queued" | "duplicate" {
    if (this.seenDeliveries.has(deliveryId)) return "duplicate";
    const headKey = `${this.prKey(job)}@${job.headSha}`;
    if (this.seenHeads.has(headKey)) return "duplicate";
    this.seenDeliveries.add(deliveryId);
    this.seenHeads.add(headKey);
    this.latestHead.set(this.prKey(job), job.headSha);
    this.chain = this.chain
      .then(() => this.runCheck(job))
      .catch((err) => console.error(`check failed for ${headKey}`, err));
    return "queued";
  }

  /** True when a newer head SHA has been queued for this job's PR. */
  isStale(job: CheckJob): boolean {
    return this.latestHead.get(this.prKey(job)) !== job.headSha;
  }

  /** Test helper: resolves when the chain has processed everything enqueued so far. */
  async idle(): Promise<void> {
    await this.chain;
  }
}
