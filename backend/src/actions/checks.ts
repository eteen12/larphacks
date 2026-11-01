// Asks Drift check (#9) to re-check a pull request via POST /checks.
export interface CheckRequester {
  requestCheck(repo: string, pr: number): Promise<void>;
}

export class FakeCheckRequester implements CheckRequester {
  readonly requests: { repo: string; pr: number }[] = [];
  private failNext = 0;

  failNextRequest(): this {
    this.failNext++;
    return this;
  }

  async requestCheck(repo: string, pr: number) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("POST /checks failed with status 503 (fake)");
    }
    this.requests.push({ repo, pr });
  }
}

export function createChecksApi({ baseUrl, apiKey, fetch: doFetch = fetch }: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): CheckRequester {
  return {
    async requestCheck(repo, pr) {
      const res = await doFetch(baseUrl.replace(/\/$/, "") + "/checks", {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ repo, pr }),
      });
      if (!res.ok) throw new Error(`POST /checks failed with status ${res.status}`);
    },
  };
}
