import { describe, expect, it } from "vitest";
import { createGitHub, createGitHubFromEnv, DRIFT_COMMENT_MARKER, GitHubError } from "../src/actions/github";
import { FakeGitHub } from "../src/actions/github.fake";
import { GitHubSim } from "./rest-sim";

const REPO = "demo-org/demo-shop";

function setup() {
  const sim = new GitHubSim();
  const gh = createGitHub({ token: "test-token", fetch: sim.fetch });
  return { sim, gh };
}

async function expectGitHubError(p: Promise<unknown>, status: number) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(GitHubError);
  expect(err.status).toBe(status);
  expect(err.message).toContain(String(status));
}

describe("#22 reopenIssue and commentOnIssue (real client against simulated REST)", () => {
  it("reopens a closed issue with one PATCH", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12, "closed");
    expect(await gh.reopenIssue(REPO, 12)).toEqual({ reopened: true });
    expect(sim.writes()).toEqual([expect.objectContaining({ method: "PATCH", path: `/repos/${REPO}/issues/12`, body: { state: "open" } })]);
    expect(sim.issues.get(`${REPO}#12`)!.state).toBe("open");
  });

  it("does nothing on an issue that is already open", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12, "open");
    expect(await gh.reopenIssue(REPO, 12)).toEqual({ reopened: false });
    expect(sim.writes()).toEqual([]);
  });

  it("throws a 404 GitHubError for an issue that does not exist", async () => {
    const { gh } = setup();
    await expectGitHubError(gh.reopenIssue(REPO, 999), 404);
    await expectGitHubError(gh.commentOnIssue(REPO, 999, "hi"), 404);
  });

  it("posts a comment and returns its link", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12);
    const res = await gh.commentOnIssue(REPO, 12, "hello");
    expect(res).toEqual({ id: 1, url: `https://github.com/${REPO}/issues/12#issuecomment-1`, created: true });
    expect(sim.writes()).toEqual([expect.objectContaining({ method: "POST", path: `/repos/${REPO}/issues/12/comments`, body: { body: "hello" } })]);
  });

  it("sends the token and GitHub API headers", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12);
    await gh.commentOnIssue(REPO, 12, "hello");
    expect(sim.requests[0]!.headers).toMatchObject({
      Authorization: "Bearer test-token",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  it("with a marker, posts once and skips on retry, even past the first page of comments", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12, "open", Array.from({ length: 150 }, (_, i) => `old ${i}`));
    const first = await gh.commentOnIssue(REPO, 12, "decision", { marker: "drift-guard:approve:f1" });
    const second = await gh.commentOnIssue(REPO, 12, "decision", { marker: "drift-guard:approve:f1" });
    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(sim.writes()).toHaveLength(1);
    expect(sim.writes()[0]!.body.body).toBe("decision\n\n<!-- drift-guard:approve:f1 -->");
    // Paged through all 151 comments on the retry.
    expect(sim.requests.filter((r) => r.method === "GET" && r.path.includes("page=2")).length).toBeGreaterThan(0);
  });

  it("surfaces GitHub server errors with their status", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 12);
    sim.failures.push({ method: "POST", path: /comments$/, status: 502 });
    await expectGitHubError(gh.commentOnIssue(REPO, 12, "x"), 502);
  });

  it("turns network failures into a GitHubError with status 0", async () => {
    const gh = createGitHub({ token: "t", fetch: async () => { throw new Error("ECONNRESET"); } });
    await expectGitHubError(gh.commentOnIssue(REPO, 1, "x"), 0);
  });

  it("rejects a malformed repo before any request", async () => {
    const { sim, gh } = setup();
    await expect(gh.commentOnIssue("not-a-repo", 1, "x")).rejects.toThrow(/owner\/name/);
    expect(sim.requests).toEqual([]);
  });

  it("fails at startup when GITHUB_WRITE_TOKEN is missing", () => {
    expect(() => createGitHubFromEnv({})).toThrow(/GITHUB_WRITE_TOKEN is not set/);
    expect(() => createGitHubFromEnv({ GITHUB_WRITE_TOKEN: "  " })).toThrow(/GITHUB_WRITE_TOKEN is not set/);
    expect(() => createGitHubFromEnv({ GITHUB_WRITE_TOKEN: "abc" })).not.toThrow();
  });
});

describe("#23 upsertPrComment (real client against simulated REST)", () => {
  it("creates the drift comment with the marker first", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 40, "open");
    const res = await gh.upsertPrComment(REPO, 40, "Drift found: discount");
    expect(res.created).toBe(true);
    expect(sim.writes()).toEqual([
      expect.objectContaining({ method: "POST", path: `/repos/${REPO}/issues/40/comments`, body: { body: `${DRIFT_COMMENT_MARKER}\nDrift found: discount` } }),
    ]);
  });

  it("edits the existing drift comment instead of duplicating it", async () => {
    const { sim, gh } = setup();
    sim.addIssue(REPO, 40, "open");
    const first = await gh.upsertPrComment(REPO, 40, "v1");
    const second = await gh.upsertPrComment(REPO, 40, "v2");
    expect(second).toEqual({ id: first.id, url: first.url, created: false });
    const comments = sim.issues.get(`${REPO}#40`)!.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe(`${DRIFT_COMMENT_MARKER}\nv2`);
    expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
      `POST /repos/${REPO}/issues/40/comments`,
      `PATCH /repos/${REPO}/issues/comments/${first.id}`,
    ]);
  });

  it("leaves other comments untouched, including other bots and approve markers", async () => {
    const { sim, gh } = setup();
    const others = ["LGTM", "<!-- sentry-bot -->\nSentry review", "@claude fix it\n\n<!-- drift-guard:approve:f1 -->"];
    sim.addIssue(REPO, 40, "open", others);
    await gh.upsertPrComment(REPO, 40, "v1");
    await gh.upsertPrComment(REPO, 40, "v2");
    const comments = sim.issues.get(`${REPO}#40`)!.comments;
    expect(comments.map((c) => c.body)).toEqual([...others, `${DRIFT_COMMENT_MARKER}\nv2`]);
  });

  it("throws with the status code when the PR does not exist", async () => {
    const { gh } = setup();
    await expectGitHubError(gh.upsertPrComment(REPO, 404, "x"), 404);
  });
});

describe("#24 setCommitStatus (real client against simulated REST)", () => {
  it("sets the drift-guard status", async () => {
    const { sim, gh } = setup();
    sim.commits.add(`${REPO}@abc123`);
    await gh.setCommitStatus(REPO, "abc123", "failure", "1 drift finding");
    expect(sim.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: `/repos/${REPO}/statuses/abc123`,
        body: { state: "failure", description: "1 drift finding", context: "drift-guard" },
      }),
    ]);
  });

  it("errors with the status code on an unknown commit", async () => {
    const { gh } = setup();
    await expectGitHubError(gh.setCommitStatus(REPO, "deadbeef", "success", "ok"), 422);
  });

  it("shortens a long description to 140 characters and still sets the status", async () => {
    const { sim, gh } = setup();
    sim.commits.add(`${REPO}@abc123`);
    await gh.setCommitStatus(REPO, "abc123", "pending", "x".repeat(500));
    const desc = sim.statuses[0]!.description;
    expect([...desc]).toHaveLength(140);
    expect(desc.endsWith("…")).toBe(true);
  });

  it("does not split a multi-byte character when shortening", async () => {
    const { sim, gh } = setup();
    sim.commits.add(`${REPO}@abc123`);
    await gh.setCommitStatus(REPO, "abc123", "pending", "🙂".repeat(200));
    expect([...sim.statuses[0]!.description].slice(0, 139).every((c) => c === "🙂")).toBe(true);
  });

  it("rejects an unknown state without calling GitHub", async () => {
    const { sim, gh } = setup();
    await expect(gh.setCommitStatus(REPO, "abc", "green" as any, "x")).rejects.toThrow(/Invalid commit state/);
    expect(sim.requests).toEqual([]);
  });
});

describe("FakeGitHub mirrors the real module", () => {
  it("records reopen, comment, upsert and status calls", async () => {
    const fake = new FakeGitHub().addIssue(REPO, 12, "closed").addIssue(REPO, 40, "open").addCommit(REPO, "abc");
    await fake.reopenIssue(REPO, 12);
    await fake.reopenIssue(REPO, 12);
    await fake.commentOnIssue(REPO, 12, "hi");
    await fake.upsertPrComment(REPO, 40, "v1");
    await fake.upsertPrComment(REPO, 40, "v2");
    await fake.setCommitStatus(REPO, "abc", "success", "y".repeat(200));
    expect(fake.calls).toEqual([
      { method: "reopenIssue", repo: REPO, target: 12, reopened: true },
      { method: "reopenIssue", repo: REPO, target: 12, reopened: false },
      { method: "commentOnIssue", repo: REPO, target: 12, body: "hi", created: true },
      { method: "upsertPrComment", repo: REPO, target: 40, body: "v1", created: true },
      { method: "upsertPrComment", repo: REPO, target: 40, body: "v2", created: false },
      { method: "setCommitStatus", repo: REPO, target: "abc", state: "success", description: "y".repeat(139) + "…" },
    ]);
    expect(fake.comments(REPO, 40)).toHaveLength(1);
  });

  it("throws the same errors: 404 unknown issue, 422 unknown commit, injected failures", async () => {
    const fake = new FakeGitHub().addIssue(REPO, 12);
    await expectGitHubError(fake.reopenIssue(REPO, 999), 404);
    await expectGitHubError(fake.setCommitStatus(REPO, "nope", "success", "x"), 422);
    fake.failNext("commentOnIssue", 503);
    await expectGitHubError(fake.commentOnIssue(REPO, 12, "x"), 503);
    await fake.commentOnIssue(REPO, 12, "x");
    expect(fake.calls).toHaveLength(1);
  });
});
