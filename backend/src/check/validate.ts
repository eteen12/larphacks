import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentFinding, CheckOutput } from "../../../shared/check-output.js";
import type { Finding } from "../../../shared/finding.js";
import type { CheckJob } from "./queue.js";

export const CONFIDENCE_THRESHOLD = 0.7;

const conflictFinding = z.object({
  item: z.string().min(1),
  kind: z.literal("conflict"),
  issue_quote: z.string().min(1),
  note_quote: z.string().min(1),
  note_path: z.string().min(1),
  note_date: z.string().min(1),
  diff_line: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

// A no_source finding cites a decision the issue made that no vault note backs;
// note fields may be empty but the issue quote and diff line are still evidence.
const noSourceFinding = conflictFinding.extend({
  kind: z.literal("no_source"),
  note_quote: z.string(),
  note_path: z.string(),
  note_date: z.string(),
});

const checkOutputSchema = z.object({
  decisions: z.array(
    z.object({
      item: z.string(),
      source: z.string(),
      quote: z.string(),
      date: z.string().nullable(),
    }),
  ),
  code: z.array(
    z.object({
      item: z.string(),
      file: z.string(),
      line: z.string(),
      does: z.string(),
    }),
  ),
  findings: z.array(z.union([conflictFinding, noSourceFinding])),
});

export class OutputValidationError extends Error {}

/** Extract the agent's JSON answer and validate it against shared/check-output. */
export function parseCheckOutput(raw: string): CheckOutput {
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new OutputValidationError("no JSON object found in agent output");
    }
    text = text.slice(start, end + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new OutputValidationError(`invalid JSON: ${(err as Error).message}`);
  }
  const result = checkOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new OutputValidationError(`schema mismatch: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return result.data;
}

/** Turn validated agent findings into stored findings: stamp identity, filter by confidence. */
export function buildFindings(
  output: CheckOutput,
  job: CheckJob,
  searches: string[],
  threshold = CONFIDENCE_THRESHOLD,
): (Finding & { head_sha: string; created_at: string })[] {
  const now = new Date().toISOString();
  return output.findings
    .filter((f: AgentFinding) => f.confidence >= threshold)
    .map((f) => ({
      id: randomUUID(),
      repo: `${job.owner}/${job.repo}`,
      pr: job.prNumber,
      issue: job.issueNumber,
      item: f.item,
      kind: f.kind,
      issue_quote: f.issue_quote,
      note_quote: f.note_quote,
      note_path: f.note_path,
      note_date: f.note_date,
      diff_line: f.diff_line,
      confidence: f.confidence,
      searches,
      state: "open" as const,
      head_sha: job.headSha,
      created_at: now,
    }));
}
