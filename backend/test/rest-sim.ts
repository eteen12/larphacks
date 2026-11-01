// Minimal in-memory GitHub REST API, passed to createGitHub as `fetch`.
// Lets tests exercise the real github.ts HTTP code (paths, methods, headers, status handling) with no network.

export interface SimRequest {
  method: string;
  path: string;
  body?: any;
  headers: Record<string, string>;
}

interface SimComment {
  id: number;
  body: string;
  html_url: string;
}

export class GitHubSim {
  readonly requests: SimRequest[] = [];
  readonly issues = new Map<string, { state: string; comments: SimComment[] }>();
  readonly commits = new Set<string>();
  readonly statuses: { repo: string; sha: string; state: string; description: string; context: string }[] = [];
  /** Respond to the next request matching method+path regex with this status. */
  readonly failures: { method: string; path: RegExp; status: number }[] = [];
  private nextId = 1;

  addIssue(repo: string, n: number, state = "closed", comments: string[] = []) {
    this.issues.set(`${repo}#${n}`, { state, comments: comments.map((b) => this.comment(repo, n, b)) });
    return this;
  }

  writes() {
    return this.requests.filter((r) => r.method !== "GET");
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const path = url.pathname + url.search;
    this.requests.push({ method, path, body, headers });

    const fail = this.failures.findIndex((f) => f.method === method && f.path.test(path));
    if (fail !== -1) {
      const [f] = this.failures.splice(fail, 1);
      return json(f!.status, { message: "Simulated failure" });
    }

    let m: RegExpExecArray | null;
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url.pathname))) {
      const issue = this.issues.get(`${m[1]}#${m[2]}`);
      if (!issue) return json(404, { message: "Not Found" });
      if (method === "GET") return json(200, { state: issue.state });
      if (method === "PATCH") {
        issue.state = body.state;
        return json(200, { state: issue.state });
      }
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(url.pathname))) {
      const issue = this.issues.get(`${m[1]}#${m[2]}`);
      if (!issue) return json(404, { message: "Not Found" });
      if (method === "GET") {
        const per = Number(url.searchParams.get("per_page") ?? 30);
        const page = Number(url.searchParams.get("page") ?? 1);
        return json(200, issue.comments.slice((page - 1) * per, page * per));
      }
      if (method === "POST") {
        const c = this.comment(m[1]!, Number(m[2]), body.body);
        issue.comments.push(c);
        return json(201, c);
      }
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/.exec(url.pathname)) && method === "PATCH") {
      for (const issue of this.issues.values()) {
        const c = issue.comments.find((x) => x.id === Number(m![2]));
        if (c) {
          c.body = body.body;
          return json(200, c);
        }
      }
      return json(404, { message: "Not Found" });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/statuses\/([^/]+)$/.exec(url.pathname)) && method === "POST") {
      if (!this.commits.has(`${m[1]}@${m[2]}`)) return json(422, { message: `No commit found for SHA: ${m[2]}` });
      if ([...body.description].length > 140) return json(422, { message: "description is too long (maximum is 140 characters)" });
      this.statuses.push({ repo: m[1]!, sha: m[2]!, ...body });
      return json(201, { url: `https://api.github.com/repos/${m[1]}/statuses/${m[2]}` });
    }
    return json(404, { message: `Sim has no route for ${method} ${url.pathname}` });
  };

  private comment(repo: string, n: number, body: string): SimComment {
    const id = this.nextId++;
    return { id, body, html_url: `https://github.com/${repo}/issues/${n}#issuecomment-${id}` };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
