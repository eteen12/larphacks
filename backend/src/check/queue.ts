export interface CheckJob {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  issueNumber: number;
  /** ms epoch at enqueue time — orders runs for the stale-run discard rule. */
  enqueuedAt: number;
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

  private prKey(job: Pick<CheckJob, "owner" | "repo" | "prNumber">): string {
    return `${job.owner}/${job.repo}#${job.prNumber}`;
  }

  enqueue(
    deliveryId: string,
    job: Omit<CheckJob, "enqueuedAt"> & Partial<Pick<CheckJob, "enqueuedAt">>,
  ): "queued" | "duplicate" {
    if (this.seenDeliveries.has(deliveryId)) return "duplicate";
    const headKey = `${this.prKey(job)}@${job.headSha}`;
    if (this.seenHeads.has(headKey)) return "duplicate";
    const full: CheckJob = { ...job, enqueuedAt: job.enqueuedAt ?? Date.now() };
    this.seenDeliveries.add(deliveryId);
    this.seenHeads.add(headKey);
    this.latestHead.set(this.prKey(full), full.headSha);
    this.chain = this.chain
      .then(() => this.runCheck(full))
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
