import { describe, expect, it, vi } from "vitest";
import { buildFindings, OutputValidationError, parseCheckOutput } from "./validate.js";
import { validateStage } from "./stages.js";
import type { CheckContext } from "./run-check.js";
import type { CheckJob } from "./queue.js";
import type { AgentResult } from "./agent.js";

const JOB: CheckJob = {
  owner: "eteen12",
  repo: "demo-repo",
  prNumber: 42,
  headSha: "abc123",
  issueNumber: 8,
  enqueuedAt: 1000,
};

const conflictFinding = {
  item: "discount rate",
  kind: "conflict",
  issue_quote: "discount is 10%",
  note_quote: "client wants 5%",
  note_path: "vault/2026-10-28.md",
  note_date: "2026-10-28",
  diff_line: "+const DISCOUNT = 0.10",
  confidence: 0.9,
};

const good = (findings: unknown[] = []) =>
  JSON.stringify({ decisions: [], code: [], findings });

describe("parseCheckOutput", () => {
  it("parses a clean answer", () => {
    const out = parseCheckOutput(good([conflictFinding]));
    expect(out.findings).toHaveLength(1);
  });

  it("unwraps a ```json fence", () => {
    const out = parseCheckOutput(`Here is the result:\n\`\`\`json\n${good()}\n\`\`\``);
    expect(out.findings).toHaveLength(0);
  });

  it("extracts JSON surrounded by prose", () => {
    const out = parseCheckOutput(`prose before ${good()} prose after`);
    expect(out.findings).toHaveLength(0);
  });

  it("rejects non-JSON output", () => {
    expect(() => parseCheckOutput("not json at all")).toThrow(OutputValidationError);
  });

  it("rejects a conflict finding missing its note quote", () => {
    const bad = { ...conflictFinding, note_quote: "" };
    expect(() => parseCheckOutput(good([bad]))).toThrow(OutputValidationError);
  });

  it("rejects a finding missing its diff line", () => {
    const bad = { ...conflictFinding, diff_line: "" };
    expect(() => parseCheckOutput(good([bad]))).toThrow(OutputValidationError);
  });

  it("accepts a no_source finding with empty note fields", () => {
    const f = { ...conflictFinding, kind: "no_source", note_quote: "", note_path: "", note_date: "" };
    const out = parseCheckOutput(good([f]));
    expect(out.findings[0].kind).toBe("no_source");
  });
});

describe("buildFindings", () => {
  it("drops findings below the threshold and keeps exactly 0.7", () => {
    const output = parseCheckOutput(
      good([
        { ...conflictFinding, confidence: 0.69, item: "dropped" },
        { ...conflictFinding, confidence: 0.7, item: "kept-edge" },
        { ...conflictFinding, confidence: 0.95, item: "kept-high" },
      ]),
    );
    const findings = buildFindings(output, JOB, ["grep margin"], 0.7);
    expect(findings.map((f) => f.item)).toEqual(["kept-edge", "kept-high"]);
  });

  it("stamps repo, pr, issue, head sha, open state and actual searches", () => {
    const output = parseCheckOutput(good([conflictFinding]));
    const [f] = buildFindings(output, JOB, ["grep a", "read vault/x.md"], 0.7);
    expect(f).toMatchObject({
      repo: "eteen12/demo-repo",
      pr: 42,
      issue: 8,
      head_sha: "abc123",
      state: "open",
      searches: ["grep a", "read vault/x.md"],
    });
    expect(f.id).toBeTruthy();
    expect(f.created_at).toBeTruthy();
  });

  it("stores empty note fields of a no_source finding as null", () => {
    const output = parseCheckOutput(
      good([{ ...conflictFinding, kind: "no_source", note_quote: "", note_path: "", note_date: "" }]),
    );
    const [f] = buildFindings(output, JOB, [], 0.7);
    expect(f).toMatchObject({ note_quote: null, note_path: null, note_date: null });
  });
});

describe("validateStage", () => {
  const ctx = (finalText: string): CheckContext => ({
    job: JOB,
    cleanups: [],
    agentResult: { finalText, searches: ["s1"], notesRead: [], toolsUsed: [], turns: 1 } as AgentResult,
  });

  it("zero findings is a successful run with no findings", async () => {
    const c = ctx(good());
    await validateStage({ rerunWithError: vi.fn() }).run(c);
    expect(c.findings).toEqual([]);
  });

  it("invalid output is retried once with the error, then succeeds", async () => {
    const c = ctx("garbage");
    const rerun = vi.fn(async (_c: CheckContext, _error: string) => ({ finalText: good([conflictFinding]) }) as AgentResult);
    await validateStage({ rerunWithError: rerun }).run(c);
    expect(rerun).toHaveBeenCalledOnce();
    expect(rerun.mock.calls[0][1]).toContain("JSON");
    expect(c.findings).toHaveLength(1);
  });

  it("invalid twice = failed run", async () => {
    const c = ctx("garbage");
    const rerun = vi.fn(async () => ({ finalText: "still garbage" }) as AgentResult);
    await expect(validateStage({ rerunWithError: rerun }).run(c)).rejects.toThrow();
  });

  it("a failed run is never treated as no drift (no empty findings on error)", async () => {
    const c = ctx("garbage");
    const rerun = vi.fn(async () => ({ finalText: "still garbage" }) as AgentResult);
    await expect(validateStage({ rerunWithError: rerun }).run(c)).rejects.toThrow();
    expect(c.findings).toBeUndefined();
  });
});
