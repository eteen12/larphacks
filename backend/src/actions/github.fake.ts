// In-memory twin of github.ts for tests. Records every call and never touches the network.
import {
  assertCommitState,
  DRIFT_COMMENT_MARKER,
  GitHubError,
  markerComment,
  parseRepo,
  STATUS_CONTEXT,
  truncateDescription,
  type CommentResult,
  type CommitState,
  type GitHubWriter,
  type IssueComment,
} from "./github.js";

export type FakeCall =
  | { method: "reopenIssue"; repo: string; target: number; reopened: boolean }
  | { method: "commentOnIssue"; repo: string; target: number; body: string; created: boolean }
  | { method: "upsertPrComment"; repo: string; target: number; body: string; created: boolean }
  | { method: "setCommitStatus"; repo: string; target: string; state: CommitState; description: string };

export type FakeMethod = FakeCall["method"];

interface FakeThread {
  state: "open" | "closed";
  comments: IssueComment[];
}

export class FakeGitHub implements GitHubWriter {
  readonly calls: FakeCall[] = [];
  readonly statuses: { repo: string; sha: string; state: CommitState; description: string; context: string }[] = [];
  private readonly threads = new Map<string, FakeThread>();
  private readonly commits = new Set<string>();
  private readonly failures: { method: FakeMethod; status: number }[] = [];
  private nextId = 1000;

  /** Issues and PRs share one number space, as on GitHub. */
  addIssue(repo: string, number: number, state: "open" | "closed" = "closed", comments: string[] = []): this {
    this.threads.set(`${repo}#${number}`, {
      state,
      comments: comments.map((body) => this.makeComment(repo, number, body)),
    });
    return this;
  }

  addCommit(repo: string, sha: string): this {
    this.commits.add(`${repo}@${sha}`);
    return this;
  }

  /** The next call to `method` throws a GitHubError with `status`. */
  failNext(method: FakeMethod, status = 500): this {
    this.failures.push({ method, status });
    return this;
  }

  issueState(repo: string, number: number): "open" | "closed" | undefined {
    return this.threads.get(`${repo}#${number}`)?.state;
  }

  comments(repo: string, number: number): IssueComment[] {
    return this.threads.get(`${repo}#${number}`)?.comments ?? [];
  }

  async reopenIssue(repo: string, issue: number) {
    this.maybeFail("reopenIssue");
    const thread = this.thread(repo, issue);
    const reopened = thread.state !== "open";
    thread.state = "open";
    this.calls.push({ method: "reopenIssue", repo, target: issue, reopened });
    return { reopened };
  }

  async commentOnIssue(repo: string, issue: number, body: string, opts: { marker?: string } = {}): Promise<CommentResult> {
    this.maybeFail("commentOnIssue");
    const thread = this.thread(repo, issue);
    let fullBody = body;
    if (opts.marker) {
      const tag = markerComment(opts.marker);
      const existing = thread.comments.find((c) => c.body.includes(tag));
      if (existing) {
        this.calls.push({ method: "commentOnIssue", repo, target: issue, body, created: false });
        return { id: existing.id, url: existing.url, created: false };
      }
      fullBody = `${body}\n\n${tag}`;
    }
    const comment = this.makeComment(repo, issue, fullBody);
    thread.comments.push(comment);
    this.calls.push({ method: "commentOnIssue", repo, target: issue, body, created: true });
    return { id: comment.id, url: comment.url, created: true };
  }

  async upsertPrComment(repo: string, pr: number, body: string): Promise<CommentResult> {
    this.maybeFail("upsertPrComment");
    const thread = this.thread(repo, pr);
    const fullBody = `${DRIFT_COMMENT_MARKER}\n${body}`;
    const existing = thread.comments.find((c) => c.body.startsWith(DRIFT_COMMENT_MARKER));
    if (existing) {
      existing.body = fullBody;
      this.calls.push({ method: "upsertPrComment", repo, target: pr, body, created: false });
      return { id: existing.id, url: existing.url, created: false };
    }
    const comment = this.makeComment(repo, pr, fullBody);
    thread.comments.push(comment);
    this.calls.push({ method: "upsertPrComment", repo, target: pr, body, created: true });
    return { id: comment.id, url: comment.url, created: true };
  }

  async setCommitStatus(repo: string, sha: string, state: CommitState, description: string) {
    this.maybeFail("setCommitStatus");
    parseRepo(repo);
    assertCommitState(state);
    if (!this.commits.has(`${repo}@${sha}`)) {
      throw new GitHubError(422, `GitHub POST /repos/${repo}/statuses/${sha} failed with status 422: No commit found for SHA: ${sha}`);
    }
    const short = truncateDescription(description);
    this.statuses.push({ repo, sha, state, description: short, context: STATUS_CONTEXT });
    this.calls.push({ method: "setCommitStatus", repo, target: sha, state, description: short });
    return { url: `https://api.github.com/repos/${repo}/statuses/${sha}` };
  }

  private thread(repo: string, number: number): FakeThread {
    parseRepo(repo);
    const thread = this.threads.get(`${repo}#${number}`);
    if (!thread) throw new GitHubError(404, `GitHub ${repo}#${number} failed with status 404: Not Found`);
    return thread;
  }

  private maybeFail(method: FakeMethod) {
    const i = this.failures.findIndex((f) => f.method === method);
    if (i === -1) return;
    const [failure] = this.failures.splice(i, 1);
    throw new GitHubError(failure!.status, `GitHub ${method} failed with status ${failure!.status} (fake)`);
  }

  private makeComment(repo: string, number: number, body: string): IssueComment {
    const id = this.nextId++;
    return { id, body, url: `https://github.com/${repo}/issues/${number}#issuecomment-${id}` };
  }
}
