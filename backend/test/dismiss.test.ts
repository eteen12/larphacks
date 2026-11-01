import { describe, expect, it } from "vitest";
import { setup, REPO } from "./helpers";

const F1 = "d15c0000-0000-4000-8000-000000000001"; // open, PR 40
const F2 = "d15c0000-0000-4000-8000-000000000002"; // open, PR 40
const SHA = "abc123";
const GREEN = { method: "setCommitStatus", repo: REPO, target: SHA, state: "success", description: "All drift findings resolved" };

function withCommit() {
  const env = setup();
  env.github.addCommit(REPO, SHA);
  return env;
}

describe("#53 POST /findings/:id/dismiss", () => {
  it("last open finding on the PR → marks dismissed and sets drift-guard success on head_sha, nothing else", async () => {
    const { github, findings, post } = withCommit();
    expect((await post(`/findings/${F1}/dismiss`, { note: "fine", by: "Ethan" })).status).toBe(200);
    const res = await post(`/findings/${F2}/dismiss`, { note: "5% confirmed by the client", by: "Ethan" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finding: { id: F2, state: "dismissed" } });
    expect(res.body.warning).toBeUndefined();
    expect(res.body.issue_comment).toBeUndefined();
    expect(findings.stateChanges).toEqual([
      { id: F1, state: "dismissed" },
      { id: F2, state: "dismissed" },
    ]);
    // Exactly one GitHub call over both dismissals: the status. No comment, no reopen.
    expect(github.calls).toEqual([GREEN]);
    expect(github.statuses).toEqual([{ repo: REPO, sha: SHA, state: "success", description: "All drift findings resolved", context: "drift-guard" }]);
    expect(github.issueState(REPO, 12)).toBe("closed");
    expect(github.comments(REPO, 12)).toEqual([]);
    expect(github.comments(REPO, 40)).toEqual([]);
  });

  it("other findings still open on the PR → marked dismissed, no GitHub call at all", async () => {
    const { github, findings, post } = withCommit();
    const res = await post(`/findings/${F1}/dismiss`, { note: "fine" });
    expect(res.status).toBe(200);
    expect(res.body.finding.state).toBe("dismissed");
    expect(findings.stateChanges).toEqual([{ id: F1, state: "dismissed" }]);
    expect(github.calls).toEqual([]);
  });

  it("findings on other PRs do not keep this PR red", async () => {
    // Fixture PR 38 (dismissed) and PR 41 (approved) are not open; dismissing both PR 40 findings must go green.
    const { github, post } = withCommit();
    await post(`/findings/${F1}/dismiss`);
    await post(`/findings/${F2}/dismiss`);
    expect(github.statuses).toHaveLength(1);
  });

  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["empty note", { note: "  " }],
  ])("%s → 200", async (_, body) => {
    const { post } = withCommit();
    expect((await post(`/findings/${F1}/dismiss`, body)).status).toBe(200);
  });

  it("400 on a non-string note, nothing changes", async () => {
    const { github, findings, post } = withCommit();
    expect((await post(`/findings/${F1}/dismiss`, { note: 5 })).status).toBe(400);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });

  it.each([["d15c0000-0000-4000-8000-000000000004"], ["d15c0000-0000-4000-8000-000000000003"]])("409 on a finding that is not open (%s), nothing changes", async (id) => {
    const { github, findings, post } = withCommit();
    expect((await post(`/findings/${id}/dismiss`, { note: "x" })).status).toBe(409);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });

  it("404 on an unknown finding", async () => {
    const { github, post } = withCommit();
    expect((await post("/findings/nope/dismiss")).status).toBe(404);
    expect(github.calls).toEqual([]);
  });

  it("same request twice: second gets 409 and sets no second status", async () => {
    const { github, post } = withCommit();
    await post(`/findings/${F1}/dismiss`);
    expect((await post(`/findings/${F2}/dismiss`)).status).toBe(200);
    expect((await post(`/findings/${F2}/dismiss`)).status).toBe(409);
    expect(github.statuses).toHaveLength(1);
  });

  it("status write fails → finding stays dismissed, 200 with a warning, error logged", async () => {
    const { github, findings, post } = withCommit();
    await post(`/findings/${F1}/dismiss`);
    github.failNext("setCommitStatus", 500);
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    let res;
    try {
      res = await post(`/findings/${F2}/dismiss`);
    } finally {
      console.error = orig;
    }
    expect(res.status).toBe(200);
    expect(res.body.finding.state).toBe("dismissed");
    expect(res.body.warning).toMatch(/dismissed, but setting the PR #40 status failed.*500/);
    expect(findings.stateChanges.at(-1)).toEqual({ id: F2, state: "dismissed" });
    expect(logged).toHaveLength(1);
    expect(String(logged[0]![0])).toContain(F2);
    expect(github.statuses).toEqual([]);
  });

  it("head commit unknown to GitHub (422) is the same warning path", async () => {
    const { post } = setup(); // commit never added
    await post(`/findings/${F1}/dismiss`);
    const orig = console.error;
    console.error = () => {};
    try {
      const res = await post(`/findings/${F2}/dismiss`);
      expect(res.status).toBe(200);
      expect(res.body.warning).toMatch(/422/);
    } finally {
      console.error = orig;
    }
  });

  it("findings store fails → 502, no status, retry succeeds", async () => {
    const { github, findings, post } = withCommit();
    await post(`/findings/${F1}/dismiss`);
    findings.failNextSetState();
    expect((await post(`/findings/${F2}/dismiss`)).status).toBe(502);
    expect(github.calls).toEqual([]);
    expect((await post(`/findings/${F2}/dismiss`)).status).toBe(200);
    expect(github.calls).toEqual([GREEN]);
  });

  it.each([
    ["missing", null],
    ["wrong", "nope"],
  ])("401 on %s API key, no writes", async (_, key) => {
    const { github, findings, post } = withCommit();
    expect((await post(`/findings/${F1}/dismiss`, {}, key)).status).toBe(401);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });
});
