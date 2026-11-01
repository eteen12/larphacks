import { describe, expect, it } from "vitest";
import { statusStage, statusStartStage } from "./status.js";
import { createRunCheck, type CheckContext } from "./run-check.js";
import { FakeGitHub } from "../actions/github.fake.js";
import type { CheckJob } from "./queue.js";
import type { StoredFinding } from "../../../shared/finding.js";

const JOB: CheckJob = {
  owner: "o",
  repo: "r",
  prNumber: 7,
  headSha: "head-sha-1",
  issueNumber: 2,
  enqueuedAt: 0,
};

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  job: JOB,
  cleanups: [],
  ...over,
});

const finding = (): StoredFinding => ({
  id: "i", repo: "o/r", pr: 7, issue: 2, item: "x", kind: "conflict",
  issue_quote: "q", note_quote: "n", note_path: "p", note_date: "d",
  diff_line: "+l", confidence: 0.9, searches: [], state: "open",
  head_sha: JOB.headSha, created_at: "",
});

const noStage = {
  name: "noop",
  async run() {},
};

const boomStage = {
  name: "boom",
  async run() {
    throw new Error("kaboom");
  },
};

describe("drift-guard status", () => {
  it("posts pending at start then success when nothing is found", async () => {
    const gh = new FakeGitHub().addCommit("o/r", JOB.headSha);
    await createRunCheck([statusStartStage({ github: gh }), noStage], [
      statusStage({ github: gh }),
    ])(JOB);
    expect(gh.statuses.map((s) => s.state)).toEqual(["pending", "success"]);
    expect(gh.statuses[1]).toMatchObject({ sha: "head-sha-1", context: "drift-guard" });
    expect(gh.statuses[1].description).toContain("No drift");
  });

  it("open findings -> failure with the count in the description", async () => {
    const gh = new FakeGitHub().addCommit("o/r", JOB.headSha);
    const saveStage = {
      name: "save",
      async run(c: CheckContext) {
        c.findings = [finding(), finding()];
      },
    };
    await createRunCheck([statusStartStage({ github: gh }), saveStage], [
      statusStage({ github: gh }),
    ])(JOB);
    expect(gh.statuses.map((s) => s.state)).toEqual(["pending", "failure"]);
    expect(gh.statuses[1].description).toContain("2 drift findings");
  });

  it("a failed run posts error, never success", async () => {
    const gh = new FakeGitHub().addCommit("o/r", JOB.headSha);
    await expect(
      createRunCheck([statusStartStage({ github: gh }), boomStage], [statusStage({ github: gh })])(
        JOB,
      ),
    ).rejects.toThrow("kaboom");
    expect(gh.statuses.map((s) => s.state)).toEqual(["pending", "error"]);
  });

  it("a discarded stale run leaves its pending status and writes no final one", async () => {
    const gh = new FakeGitHub().addCommit("o/r", JOB.headSha);
    await statusStartStage({ github: gh }).run(ctx());
    await statusStage({ github: gh }).run(ctx({ discarded: true }));
    expect(gh.statuses.map((s) => s.state)).toEqual(["pending"]);
  });

  it("each new head sha gets its own status; the older one is untouched", async () => {
    const gh = new FakeGitHub().addCommit("o/r", "sha-old").addCommit("o/r", "sha-new");
    for (const sha of ["sha-old", "sha-new"]) {
      await createRunCheck([statusStartStage({ github: gh }), noStage], [statusStage({ github: gh })])({
        ...JOB,
        headSha: sha,
        enqueuedAt: 1,
      });
    }
    const perSha = new Map(gh.statuses.map((s) => [`${s.sha}:${s.state}`, true]));
    expect(perSha.has("sha-old:success")).toBe(true);
    expect(perSha.has("sha-new:success")).toBe(true);
    expect(gh.statuses).toHaveLength(4);
  });

  it("a GitHub outage on the pending status does not kill the run", async () => {
    const gh = new FakeGitHub().addCommit("o/r", JOB.headSha).failNext("setCommitStatus", 500);
    await expect(
      createRunCheck([statusStartStage({ github: gh }), noStage], [statusStage({ github: gh })])(JOB),
    ).resolves.toBeUndefined();
    expect(gh.statuses.map((s) => s.state)).toEqual(["success"]);
  });
});
