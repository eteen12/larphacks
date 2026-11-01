// How approve, dismiss and MCP read and update findings: the DB store (running server) or an in-memory fake (tests).
import type { StoredFinding } from "../../../shared/finding.js";
import type { Finding, FindingState } from "../finding";
import { getFindingById, listFindingsByIssue, setFindingState, type PoolLike } from "../check/store.js";

export interface FindingsStore {
  get(id: string): Promise<Finding | null>;
  setState(id: string, state: Exclude<FindingState, "open">): Promise<void>;
  listByIssue(repo: string, issue: number): Promise<Finding[]>;
}

export class FindingsStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FindingsStoreError";
  }
}

export class FakeFindingsStore implements FindingsStore {
  readonly stateChanges: { id: string; state: FindingState }[] = [];
  private readonly findings = new Map<string, Finding>();
  private failSetState = 0;

  constructor(seed: Finding[] = []) {
    for (const f of seed) this.findings.set(f.id, structuredClone(f));
  }

  failNextSetState(): this {
    this.failSetState++;
    return this;
  }

  async get(id: string) {
    const f = this.findings.get(id);
    return f ? structuredClone(f) : null;
  }

  async setState(id: string, state: Exclude<FindingState, "open">) {
    if (this.failSetState > 0) {
      this.failSetState--;
      throw new FindingsStoreError(500, "Findings store write failed (fake)");
    }
    const f = this.findings.get(id);
    if (!f) throw new FindingsStoreError(404, `Finding ${id} not found`);
    f.state = state;
    this.stateChanges.push({ id, state });
  }

  async listByIssue(repo: string, issue: number) {
    return [...this.findings.values()].filter((f) => f.repo === repo && f.issue === issue).map((f) => structuredClone(f));
  }
}

/** Drop run provenance (head_sha, created_at): approve/dismiss/MCP hand out the shared Finding shape. */
function toFinding({ head_sha: _sha, created_at: _at, ...finding }: StoredFinding): Finding {
  return finding;
}

/** The running server's store: reads and updates the findings table directly, no HTTP. */
export function createDbFindingsStore(pool: PoolLike): FindingsStore {
  return {
    async get(id) {
      const row = await getFindingById(pool, id);
      return row && toFinding(row);
    },
    async setState(id, state) {
      if (!(await setFindingState(pool, id, state))) throw new FindingsStoreError(404, `Finding ${id} not found`);
    },
    async listByIssue(repo, issue) {
      return (await listFindingsByIssue(pool, repo, issue)).map(toFinding);
    },
  };
}
