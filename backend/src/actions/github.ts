// The only code in the product that writes to GitHub (#21).
// Every function takes the repo explicitly and either succeeds or throws a GitHubError with the status code.

export type CommitState = "pending" | "success" | "failure" | "error";
export const COMMIT_STATES: readonly CommitState[] = ["pending", "success", "failure", "error"];

export const DRIFT_COMMENT_MARKER = "<!-- drift-guard -->";
export const STATUS_CONTEXT = "drift-guard";
export const STATUS_DESCRIPTION_LIMIT = 140;

export interface IssueComment {
  id: number;
  body: string;
  url: string;
}

export interface CommentResult {
  id: number;
  url: string;
  /** false when a comment with the same marker already existed and nothing was posted. */
  created: boolean;
}

export interface CommentOptions {
  /** Hidden marker; the comment is posted at most once per issue per marker. */
  marker?: string;
}

export interface GitHubWriter {
  reopenIssue(repo: string, issue: number): Promise<{ reopened: boolean }>;
  commentOnIssue(repo: string, issue: number, body: string, opts?: CommentOptions): Promise<CommentResult>;
  upsertPrComment(repo: string, pr: number, body: string): Promise<CommentResult>;
  setCommitStatus(repo: string, sha: string, state: CommitState, description: string): Promise<{ url: string }>;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export function parseRepo(repo: string): { owner: string; name: string } {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
  if (!match) throw new Error(`Invalid repo "${repo}", expected owner/name`);
  return { owner: match[1]!, name: match[2]! };
}

export function markerComment(marker: string): string {
  return `<!-- ${marker} -->`;
}

export function truncateDescription(description: string): string {
  const chars = [...description];
  if (chars.length <= STATUS_DESCRIPTION_LIMIT) return description;
  return chars.slice(0, STATUS_DESCRIPTION_LIMIT - 1).join("") + "…";
}

export function assertCommitState(state: string): asserts state is CommitState {
  if (!COMMIT_STATES.includes(state as CommitState)) {
    throw new Error(`Invalid commit state "${state}", expected one of ${COMMIT_STATES.join(", ")}`);
  }
}

export interface GitHubOptions {
  token: string;
  fetch?: typeof fetch;
  apiUrl?: string;
}

export function createGitHub({ token, fetch: doFetch = fetch, apiUrl = "https://api.github.com" }: GitHubOptions): GitHubWriter {
  if (!token) throw new Error("GitHub write token is empty");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(apiUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "drift-guard",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new GitHubError(0, `GitHub ${method} ${path} failed before a response (status 0): ${(err as Error).message}`);
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        // body was not JSON
      }
      throw new GitHubError(res.status, `GitHub ${method} ${path} failed with status ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  function repoPath(repo: string): string {
    const { owner, name } = parseRepo(repo);
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  }

  type ApiComment = { id: number; body?: string; html_url: string };

  async function listComments(repo: string, issue: number): Promise<IssueComment[]> {
    const all: IssueComment[] = [];
    for (let page = 1; ; page++) {
      const batch = await request<ApiComment[]>("GET", `${repoPath(repo)}/issues/${issue}/comments?per_page=100&page=${page}`);
      all.push(...batch.map((c) => ({ id: c.id, body: c.body ?? "", url: c.html_url })));
      if (batch.length < 100) return all;
    }
  }

  return {
    async reopenIssue(repo, issue) {
      const current = await request<{ state: string }>("GET", `${repoPath(repo)}/issues/${issue}`);
      if (current.state === "open") return { reopened: false };
      await request("PATCH", `${repoPath(repo)}/issues/${issue}`, { state: "open" });
      return { reopened: true };
    },

    async commentOnIssue(repo, issue, body, opts = {}) {
      let fullBody = body;
      if (opts.marker) {
        const tag = markerComment(opts.marker);
        const existing = (await listComments(repo, issue)).find((c) => c.body.includes(tag));
        if (existing) return { id: existing.id, url: existing.url, created: false };
        fullBody = `${body}\n\n${tag}`;
      }
      const created = await request<ApiComment>("POST", `${repoPath(repo)}/issues/${issue}/comments`, { body: fullBody });
      return { id: created.id, url: created.html_url, created: true };
    },

    async upsertPrComment(repo, pr, body) {
      const fullBody = `${DRIFT_COMMENT_MARKER}\n${body}`;
      const existing = (await listComments(repo, pr)).find((c) => c.body.startsWith(DRIFT_COMMENT_MARKER));
      if (existing) {
        const edited = await request<ApiComment>("PATCH", `${repoPath(repo)}/issues/comments/${existing.id}`, { body: fullBody });
        return { id: edited.id, url: edited.html_url, created: false };
      }
      const created = await request<ApiComment>("POST", `${repoPath(repo)}/issues/${pr}/comments`, { body: fullBody });
      return { id: created.id, url: created.html_url, created: true };
    },

    async setCommitStatus(repo, sha, state, description) {
      assertCommitState(state);
      const created = await request<{ url: string }>("POST", `${repoPath(repo)}/statuses/${encodeURIComponent(sha)}`, {
        state,
        description: truncateDescription(description),
        context: STATUS_CONTEXT,
      });
      return { url: created.url };
    },
  };
}

/** Call at startup so a missing token fails loudly before the first request. */
export function createGitHubFromEnv(env: NodeJS.ProcessEnv = process.env, doFetch?: typeof fetch): GitHubWriter {
  const token = env.GITHUB_WRITE_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_WRITE_TOKEN is not set; drift guard cannot write to GitHub");
  return createGitHub({ token, fetch: doFetch });
}
