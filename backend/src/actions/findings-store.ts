// How #4 reads and updates findings. The HTTP store calls the findings API (#18);
// the fake is an in-memory stand-in until #18 lands.
import type { Finding, FindingState } from "../finding";

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
      throw new FindingsStoreError(500, "Findings API PATCH failed with status 500 (fake)");
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

export function createFindingsApiStore({ baseUrl, apiKey, fetch: doFetch = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): FindingsStore {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await doFetch(baseUrl.replace(/\/$/, "") + path, {
      method,
      headers: { "x-api-key": apiKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  return {
    async get(id) {
      const res = await call("GET", `/findings/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new FindingsStoreError(res.status, `Findings API GET /findings/${id} failed with status ${res.status}`);
      return (await res.json()) as Finding;
    },
    async setState(id, state) {
      const res = await call("PATCH", `/findings/${encodeURIComponent(id)}/state`, { state });
      if (!res.ok) throw new FindingsStoreError(res.status, `Findings API PATCH /findings/${id}/state failed with status ${res.status}`);
    },
    async listByIssue(repo, issue) {
      const res = await call("GET", "/findings");
      if (!res.ok) throw new FindingsStoreError(res.status, `Findings API GET /findings failed with status ${res.status}`);
      const body = (await res.json()) as Finding[] | { findings: Finding[] };
      const all = Array.isArray(body) ? body : body.findings;
      return all.filter((f) => f.repo === repo && f.issue === issue);
    },
  };
}
