import { describe, expect, it } from "vitest";
import { extractLinkedTask } from "./linked-task.js";

describe("extractLinkedTask", () => {
  it("uses the first GitHub-linked closing issue", () => {
    expect(
      extractLinkedTask({ closingIssueNumbers: [12, 34], body: null, headRefName: "x" }),
    ).toBe(12);
  });

  it("linked epic is returned like any other linked issue", () => {
    expect(
      extractLinkedTask({ closingIssueNumbers: [1], body: null, headRefName: "fix-typo" }),
    ).toBe(1);
  });

  it("parses Closes #N in the body", () => {
    expect(extractLinkedTask({ body: "Does the thing.\nCloses #12", headRefName: "x" })).toBe(12);
  });

  it.each(["closes #12", "FIXES #12", "Resolves #99"]) (
    "parses case-insensitive keyword %s",
    (body) => {
      expect(extractLinkedTask({ body, headRefName: "x" })).toBe(Number(body.split("#")[1]));
    },
  );

  it("uses the first keyword in body order", () => {
    expect(
      extractLinkedTask({ body: "Fixes #3 and also closes #4", headRefName: "x" }),
    ).toBe(3);
  });

  it.each([
    "Closes eteen12/other-repo#12",
    "Closes https://github.com/eteen12/other-repo/issues/12",
  ])("ignores cross-repo keyword %s", (body) => {
    expect(extractLinkedTask({ body, headRefName: "fix-typo" })).toBeNull();
  });

  it("falls back to a leading number on the branch name", () => {
    expect(
      extractLinkedTask({ body: "no link here", headRefName: "12-discount-rate" }),
    ).toBe(12);
    expect(extractLinkedTask({ body: null, headRefName: "12" })).toBe(12);
    expect(extractLinkedTask({ body: null, headRefName: "12_discount" })).toBe(12);
  });

  it("returns null for an unlinked PR", () => {
    expect(
      extractLinkedTask({ body: "just a fix", headRefName: "fix-typo" }),
    ).toBeNull();
    expect(
      extractLinkedTask({ body: null, headRefName: "99problems" }),
    ).toBeNull();
  });

  it("body keyword beats branch number", () => {
    expect(
      extractLinkedTask({ body: "Closes #12", headRefName: "99-other" }),
    ).toBe(12);
  });

  it("closing issue beats body keyword", () => {
    expect(
      extractLinkedTask({
        closingIssueNumbers: [7],
        body: "Closes #12",
        headRefName: "99-other",
      }),
    ).toBe(7);
  });

  it("empty closing-issues list falls through to body", () => {
    expect(
      extractLinkedTask({ closingIssueNumbers: [], body: "Closes #12", headRefName: "x" }),
    ).toBe(12);
  });
});
