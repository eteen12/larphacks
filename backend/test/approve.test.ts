import { describe, expect, it } from "vitest";
import { setup, REPO } from "./helpers";

const INSTRUCTION = "Change the slow-season discount to 8%";

describe("#26 POST /findings/:id/approve", () => {
  it("reopens the issue, records the decision, asks @claude on the PR, then marks approved", async () => {
    const { github, findings, post } = setup();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION, by: "Ethan" });

    expect(res.status).toBe(200);
    expect(res.body.finding).toMatchObject({ id: "d15c0000-0000-4000-8000-000000000001", state: "approved" });
    expect(res.body.issue_comment).toMatch(/\/issues\/12#issuecomment-/);
    expect(res.body.pr_comment).toMatch(/\/issues\/40#issuecomment-/);

    // Exact GitHub calls, in order.
    expect(github.calls.map((c) => [c.method, c.target])).toEqual([
      ["reopenIssue", 12],
      ["commentOnIssue", 12],
      ["commentOnIssue", 40],
    ]);
    expect(github.issueState(REPO, 12)).toBe("open");

    const issueBody = (github.calls[1] as any).body as string;
    expect(issueBody).toBe(
      [
        "## Drift decision",
        "Item: Slow-season discount",
        `Decision: ${INSTRUCTION}`,
        "By: Ethan, 2026-10-28",
        "Finding: d15c0000-0000-4000-8000-000000000001",
        "",
        "**Evidence**",
        "Client note (`meetings/2026-10-28 call.md`, 2026-10-28):",
        "> Let's make the slow-season discount 8%, not 5%.",
        "Issue #12:",
        "> Apply a 10% slow-season discount from November to February.",
        "Diff (PR #40): `src/discount.ts:14 + const SLOW_SEASON_DISCOUNT = 0.10;`",
      ].join("\n"),
    );
    expect(issueBody).not.toContain("@claude");

    const prBody = (github.calls[2] as any).body as string;
    expect(prBody.startsWith(`@claude ${INSTRUCTION}`)).toBe(true);
    expect(prBody).toContain("meetings/2026-10-28 call.md");
    expect(prBody).toContain("2026-10-28");
    expect(prBody).toContain("> Let's make the slow-season discount 8%, not 5%.");
    expect(prBody).toContain("> Apply a 10% slow-season discount");
    expect(prBody).toContain("src/discount.ts:14");

    // Hidden retry markers are stored on GitHub.
    expect(github.comments(REPO, 12)[0]!.body).toContain("<!-- drift-guard:approve:d15c0000-0000-4000-8000-000000000001 -->");
    expect(github.comments(REPO, 40)[0]!.body).toContain("<!-- drift-guard:approve:d15c0000-0000-4000-8000-000000000001 -->");

    expect(findings.stateChanges).toEqual([{ id: "d15c0000-0000-4000-8000-000000000001", state: "approved" }]);
  });

  it("never posts @claude on the issue", async () => {
    const { github, post } = setup();
    await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION });
    for (const c of github.comments(REPO, 12)) expect(c.body).not.toContain("@claude");
  });

  it("handles a no_source finding with no note", async () => {
    const { github, post } = setup();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000002/approve", { instruction: "Remove the deposit until the client confirms it" });
    expect(res.status).toBe(200);
    expect((github.calls[1] as any).body).toContain("Client note: none found in the vault.");
  });

  it("defaults By to the inbox", async () => {
    const { github, post } = setup();
    await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION });
    expect((github.calls[1] as any).body).toContain("By: Drift guard inbox, 2026-10-28");
  });

  it.each([
    ["missing", {}],
    ["empty", { instruction: "" }],
    ["whitespace", { instruction: "   " }],
    ["not a string", { instruction: 8 }],
  ])("400 on %s instruction, no writes", async (_, body) => {
    const { github, findings, post } = setup();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", body);
    expect(res.status).toBe(400);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });

  it("400 on a body that is not JSON", async () => {
    const { github, post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", "{not json")).status).toBe(400);
    expect(github.calls).toEqual([]);
  });

  it.each([["d15c0000-0000-4000-8000-000000000004"], ["d15c0000-0000-4000-8000-000000000003"]])("409 on a finding that is not open (%s), no writes", async (id) => {
    const { github, findings, post } = setup();
    const res = await post(`/findings/${id}/approve`, { instruction: INSTRUCTION });
    expect(res.status).toBe(409);
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });

  it("404 on an unknown finding", async () => {
    const { github, post } = setup();
    expect((await post("/findings/nope/approve", { instruction: INSTRUCTION })).status).toBe(404);
    expect(github.calls).toEqual([]);
  });

  it("PR comment fails after the issue comment: 502, state unchanged; retry posts only the missing comment", async () => {
    const { github, findings, post } = setup();
    let n = 0;
    const original = github.commentOnIssue.bind(github);
    // Fail the second commentOnIssue (the PR comment) once.
    github.commentOnIssue = async (...args) => {
      if (++n === 2) github.failNext("commentOnIssue", 502);
      return original(...args);
    };

    const first = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION });
    expect(first.status).toBe(502);
    expect(first.body.error).toMatch(/502/);
    expect(findings.stateChanges).toEqual([]);
    expect((await findings.get("d15c0000-0000-4000-8000-000000000001"))!.state).toBe("open");
    expect(github.comments(REPO, 12)).toHaveLength(1);
    expect(github.comments(REPO, 40)).toHaveLength(0);

    github.calls.length = 0;
    const retry = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION });
    expect(retry.status).toBe(200);
    expect(github.calls.map((c) => [c.method, c.target, "created" in c ? c.created : (c as any).reopened])).toEqual([
      ["reopenIssue", 12, false], // already open, no write
      ["commentOnIssue", 12, false], // marker found, not posted again
      ["commentOnIssue", 40, true], // the missing one
    ]);
    expect(github.comments(REPO, 12)).toHaveLength(1);
    expect(github.comments(REPO, 40)).toHaveLength(1);
    expect(findings.stateChanges).toEqual([{ id: "d15c0000-0000-4000-8000-000000000001", state: "approved" }]);
  });

  it("reopen fails: 502, nothing commented, state unchanged", async () => {
    const { github, findings, post } = setup();
    github.failNext("reopenIssue", 403);
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("403");
    expect(github.calls).toEqual([]);
    expect(findings.stateChanges).toEqual([]);
  });

  it("findings API fails after GitHub writes: 502, and a retry finishes without duplicate comments", async () => {
    const { github, findings, post } = setup();
    findings.failNextSetState();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION })).status).toBe(502);
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION })).status).toBe(200);
    expect(github.comments(REPO, 12)).toHaveLength(1);
    expect(github.comments(REPO, 40)).toHaveLength(1);
  });

  it("same request twice: second gets 409 and writes nothing", async () => {
    const { github, post } = setup();
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION })).status).toBe(200);
    const before = github.calls.length;
    expect((await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION })).status).toBe(409);
    expect(github.calls.length).toBe(before);
  });

  it.each([
    ["missing", null],
    ["wrong", "nope"],
  ])("401 on %s API key, no writes", async (_, key) => {
    const { github, post } = setup();
    const res = await post("/findings/d15c0000-0000-4000-8000-000000000001/approve", { instruction: INSTRUCTION }, key);
    expect(res.status).toBe(401);
    expect(github.calls).toEqual([]);
  });
});
