import { describe, expect, it } from "vitest";
import { commentStage, formatComment } from "./pr-comment.js";
import { createRunCheck, type CheckContext } from "./run-check.js";
import { FakeGitHub } from "../actions/github.fake.js";
import type { CheckJob } from "./queue.js";
import type { StoredFinding } from "../../../shared/finding.js";

const JOB: CheckJob = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  headSha: "abc",
  issueNumber: 2,
  enqueuedAt: 0,
};

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  job: JOB,
  cleanups: [],
  ...over,
});

const finding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: "id1",
  repo: "o/r",
  pr: 7,
  issue: 2,
  item: "discount rate",
  kind: "conflict",
  issue_quote: "discount is 10%",
  note_quote: "client wants 5%",
  note_path: "vault/2026-10-28.md",
  note_date: "2026-10-28",
  diff_line: "+const DISCOUNT = 0.10",
  confidence: 0.9,
  searches: ["grep discount"],
  state: "open",
  head_sha: "abc",
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("formatComment", () => {
  it("no findings -> 'No drift found'", () => {
    const body = formatComment(ctx({ findings: [] }));
    expect(body).toContain("No drift found");
    expect(body).not.toContain("drift-guard"); // marker is github.ts's job
  });

  it("failed run says the check failed — never 'no drift'", () => {
    const body = formatComment(ctx({ error: new Error("vault clone exploded") }));
    expect(body.toLowerCase()).toContain("failed");
    expect(body).toContain("vault clone exploded");
    expect(body).not.toContain("No drift found");
  });

  it("lists conflicts/no-source with quotes, paths, diff lines", () => {
    const body = formatComment(
      ctx({
        findings: [
          finding(),
          finding({ id: "id2", item: "shipping", kind: "no_source", note_quote: "", note_path: "", note_date: "" }),
        ],
        agentResult: {
          finalText: "{}",
          searches: ["grep discount", "glob vault/**"],
          notesRead: ["vault/2026-10-28.md"],
          toolsUsed: ["Grep", "Read"],
          turns: 4,
        },
      }),
    );
    expect(body).toContain("discount rate");
    expect(body).toContain("conflict");
    expect(body).toContain("no source");
    expect(body).toContain("discount is 10%"); // issue quote
    expect(body).toContain("client wants 5%"); // note quote
    expect(body).toContain("vault/2026-10-28.md"); // note path
    expect(body).toContain("+const DISCOUNT = 0.10"); // diff line
    expect(body).toContain("<details>");
    expect(body).toContain("grep discount"); // every search listed
    expect(body).toContain("No vault source found");
  });
});

describe("commentStage", () => {
  it("upserts through GitHubWriter exactly once per run", async () => {
    const gh = new FakeGitHub().addIssue("o/r", 7);
    await commentStage({ github: gh }).run(ctx({ findings: [finding()] }));
    const calls = gh.calls.filter((c) => c.method === "upsertPrComment");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ repo: "o/r", target: 7 });
  });

  it("a discarded stale run posts nothing", async () => {
    const gh = new FakeGitHub().addIssue("o/r", 7);
    await commentStage({ github: gh }).run(ctx({ discarded: true, findings: [finding()] }));
    expect(gh.calls).toHaveLength(0);
  });

  it("a GitHub failure does not fail the run", async () => {
    const gh = new FakeGitHub().addIssue("o/r", 7).failNext("upsertPrComment", 500);
    await expect(commentStage({ github: gh }).run(ctx({ findings: [] }))).resolves.toBeUndefined();
  });
});

describe("runCheck reporters", () => {
  it("a failed pipeline stage still posts the failed-check comment", async () => {
    const gh = new FakeGitHub().addIssue("o/r", 7);
    const run = createRunCheck(
      [
        {
          name: "explode",
          async run() {
            throw new Error("workspace exploded");
          },
        },
      ],
      [commentStage({ github: gh })],
    );
    await expect(run(JOB)).rejects.toThrow("workspace exploded");
    const calls = gh.calls.filter((c) => c.method === "upsertPrComment");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toContain("Drift check failed");
  });
});
