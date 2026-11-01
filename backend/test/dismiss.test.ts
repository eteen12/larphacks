import { describe, expect, it } from "vitest";
import { setup, REPO } from "./helpers";

const NOTE = "5% confirmed by client on the Oct 30 call";

describe("#27 POST /findings/:id/dismiss", () => {
  it("comments the decision, marks dismissed, then requests a re-check; does not reopen", async () => {
    const { github, findings, checks, post } = setup();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE, by: "Ethan" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finding: { id: "d15c0000-0000-4000-8000-000000000001", state: "dismissed" } });
    expect(res.body.warning).toBeUndefined();
    expect(res.body.issue_comment).toMatch(/\/issues\/12#issuecomment-/);

    expect(github.calls).toEqual([
      {
        method: "commentOnIssue",
        repo: REPO,
        target: 12,
        created: true,
        body: ["## Drift decision", "Item: Slow-season discount", `Decision: ${NOTE}`, "By: Ethan, 2026-10-28", "Finding: d15c0000-0000-4000-8000-000000000001"].join("\n"),
      },
    ]);
    expect(github.issueState(REPO, 12)).toBe("closed");
    expect(github.comments(REPO, 12)[0]!.body).toContain("<!-- drift-guard:dismiss:d15c0000-0000-4000-8000-000000000001 -->");
    expect(findings.stateChanges).toEqual([{ id: "d15c0000-0000-4000-8000-000000000001", state: "dismissed" }]);
    expect(checks.requests).toEqual([{ repo: REPO, pr: 40 }]);
  });

  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["empty note", { note: "  " }],
  ])("%s → default decision text", async (_, body) => {
    const { github, post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", body)).status).toBe(200);
    expect((github.calls[0] as any).body).toContain("Decision: Dismissed, no reason given");
  });

  it("400 on a non-string note", async () => {
    const { github, post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: 5 })).status).toBe(400);
    expect(github.calls).toEqual([]);
  });

  it.each([["d15c0000-0000-4000-8000-000000000004"], ["d15c0000-0000-4000-8000-000000000003"]])("409 on a finding that is not open (%s), no writes, no re-check", async (id) => {
    const { github, findings, checks, post } = setup();
    expect((await post(`/findings/${id}/dismiss`, { note: NOTE })).status).toBe(409);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
    expect(checks.requests).toEqual([]);
  });

  it("re-check fails after comment and state change → 200 with a warning", async () => {
    const { findings, checks, post } = setup();
    checks.failNextRequest();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/Re-check request failed.*next push to PR #40/);
    expect(findings.stateChanges).toEqual([{ id: "d15c0000-0000-4000-8000-000000000001", state: "dismissed" }]);
  });

  it("GitHub comment fails → 502, state unchanged, no re-check; retry succeeds once", async () => {
    const { github, findings, checks, post } = setup();
    github.failNext("commentOnIssue", 500);
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("500");
    expect(findings.stateChanges).toEqual([]);
    expect(checks.requests).toEqual([]);

    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE })).status).toBe(200);
    expect(github.comments(REPO, 12)).toHaveLength(1);
  });

  it("findings API fails after the comment → 502; retry does not post a second comment", async () => {
    const { github, findings, checks, post } = setup();
    findings.failNextSetState();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE })).status).toBe(502);
    expect(checks.requests).toEqual([]);
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE })).status).toBe(200);
    expect(github.comments(REPO, 12)).toHaveLength(1);
    expect(checks.requests).toHaveLength(1);
  });

  it("same request twice: second gets 409", async () => {
    const { post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE })).status).toBe(200);
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE })).status).toBe(409);
  });

  it.each([
    ["missing", null],
    ["wrong", "nope"],
  ])("401 on %s API key, no writes", async (_, key) => {
    const { github, checks, post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/dismiss", { note: NOTE }, key)).status).toBe(401);
    expect(github.calls).toEqual([]);
    expect(checks.requests).toEqual([]);
  });
});
