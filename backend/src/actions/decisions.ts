// Carries out approve, dismiss and recorded decisions on GitHub (#25).
// Shared by the HTTP routes and the MCP tools so there is one copy of the logic. Makes no drift judgements.
import type { Finding } from "../finding";
import { FindingsStoreError, type FindingsStore } from "./findings-store";
import { GitHubError, type GitHubWriter } from "./github";

export interface ActionDeps {
  github: GitHubWriter;
  findings: FindingsStore;
  now?: () => Date;
}

export type ActionResult<T> = { ok: true; body: T } | { ok: false; status: 400 | 404 | 409 | 502; error: string };

export interface ApproveResult {
  finding: Finding;
  issue_comment: string;
  pr_comment: string;
}

export interface DismissResult {
  finding: Finding;
  /** Set when the finding was dismissed but the PR's status could not be set. */
  warning?: string;
}

export const ALL_RESOLVED = "All drift findings resolved";

export interface RecordResult {
  issue_comment: string;
}

export function decisionMarker(kind: "approve" | "dismiss", findingId: string): string {
  return `drift-guard:${kind}:${findingId}`;
}

/** The format #5's check prompt treats as "already settled". */
export function formatDecision(d: { item: string; decision: string; by: string; date: string; findingId?: string }): string {
  return [
    "## Drift decision",
    `Item: ${d.item}`,
    `Decision: ${d.decision}`,
    `By: ${d.by}, ${d.date}`,
    `Finding: ${d.findingId ?? "none"}`,
  ].join("\n");
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

function evidence(f: Finding): string {
  const lines = ["", "**Evidence**"];
  if (f.note_quote) lines.push(`Client note (\`${f.note_path ?? "unknown note"}\`, ${f.note_date ?? "undated"}):`, quote(f.note_quote));
  else lines.push("Client note: none found in the vault.");
  if (f.issue_quote) lines.push(`Issue #${f.issue}:`, quote(f.issue_quote));
  if (f.diff_line) lines.push(`Diff (PR #${f.pr}): \`${f.diff_line}\``);
  return lines.join("\n");
}

export function approveIssueComment(f: Finding, instruction: string, by: string, date: string): string {
  return formatDecision({ item: f.item, decision: instruction, by, date, findingId: f.id }) + "\n" + evidence(f);
}

/** Starts with @claude so claude-code-action picks it up on the PR, where the fix must land. */
export function approvePrComment(f: Finding, instruction: string): string {
  const lines = [`@claude ${instruction}`, "", `Drift guard finding \`${f.id}\` on "${f.item}" was approved for a fix.`];
  if (f.note_quote) lines.push(`Client note (\`${f.note_path ?? "unknown note"}\`, ${f.note_date ?? "undated"}):`, quote(f.note_quote));
  if (f.issue_quote) lines.push(`Issue #${f.issue} says:`, quote(f.issue_quote));
  if (f.diff_line) lines.push(`Diff line: \`${f.diff_line}\``);
  lines.push("", `Push the fix to this pull request's branch and update #${f.issue}'s spec to match.`);
  return lines.join("\n");
}

function today(deps: ActionDeps): string {
  return (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
}

async function loadOpenFinding(deps: ActionDeps, id: string): Promise<ActionResult<Finding>> {
  const finding = await deps.findings.get(id);
  if (!finding) return { ok: false, status: 404, error: `Finding ${id} not found` };
  if (finding.state !== "open") return { ok: false, status: 409, error: `Finding ${id} is already ${finding.state}` };
  return { ok: true, body: finding };
}

/** GitHub and findings API failures become 502 so the caller can retry; anything else is a bug and is rethrown. */
function upstreamFailure(err: unknown, what: string): { ok: false; status: 502; error: string } {
  if (err instanceof GitHubError || err instanceof FindingsStoreError) {
    return { ok: false, status: 502, error: `${what}: ${err.message}. Nothing was marked; retrying is safe.` };
  }
  throw err;
}

export async function approveFinding(
  deps: ActionDeps,
  input: { findingId: string; instruction: unknown; by?: string },
): Promise<ActionResult<ApproveResult>> {
  const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
  if (!instruction) return { ok: false, status: 400, error: "instruction is required and must be a non-empty string" };

  const loaded = await loadOpenFinding(deps, input.findingId);
  if (!loaded.ok) return loaded;
  const f = loaded.body;
  const marker = decisionMarker("approve", f.id);
  const by = input.by?.trim() || "Drift guard inbox";

  let issueComment, prComment;
  try {
    await deps.github.reopenIssue(f.repo, f.issue);
    issueComment = await deps.github.commentOnIssue(f.repo, f.issue, approveIssueComment(f, instruction, by, today(deps)), { marker });
    prComment = await deps.github.commentOnIssue(f.repo, f.pr, approvePrComment(f, instruction), { marker });
  } catch (err) {
    return upstreamFailure(err, "GitHub write failed");
  }

  try {
    await deps.findings.setState(f.id, "approved");
  } catch (err) {
    return upstreamFailure(err, "GitHub writes succeeded but updating the finding failed");
  }

  return { ok: true, body: { finding: { ...f, state: "approved" }, issue_comment: issueComment.url, pr_comment: prComment.url } };
}

/**
 * Dismiss only records the decision in the database. When it was the PR's last open finding,
 * the head commit's drift-guard status goes green. No issue comment, no reopen, no re-check (#53).
 * `note` is validated but not stored: the findings table has no column for it.
 */
export async function dismissFinding(
  deps: ActionDeps,
  input: { findingId: string; note?: unknown; by?: string },
): Promise<ActionResult<DismissResult>> {
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return { ok: false, status: 400, error: "note must be a string" };
  }

  const loaded = await loadOpenFinding(deps, input.findingId);
  if (!loaded.ok) return loaded;
  const f = loaded.body;

  try {
    await deps.findings.setState(f.id, "dismissed");
  } catch (err) {
    return upstreamFailure(err, "Updating the finding failed");
  }

  const body: DismissResult = { finding: { ...f, state: "dismissed" } };
  try {
    if ((await deps.findings.countOpenOnPr(f.repo, f.pr)) === 0) {
      const sha = await deps.findings.headSha(f.id);
      if (!sha) throw new Error(`no head commit recorded for finding ${f.id}`);
      await deps.github.setCommitStatus(f.repo, sha, "success", ALL_RESOLVED);
    }
  } catch (err) {
    console.error(`drift-guard success status failed after dismissing ${f.id} (${f.repo}#${f.pr})`, err);
    body.warning = `Finding dismissed, but setting the PR #${f.pr} status failed (${(err as Error).message}); the next push to the PR will re-check.`;
  }
  return { ok: true, body };
}

export async function recordDecision(
  deps: ActionDeps,
  input: { repo: string; issue: number; text: unknown; item?: string; by?: string },
): Promise<ActionResult<RecordResult>> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return { ok: false, status: 400, error: "text is required and must be a non-empty string" };
  const by = input.by?.trim() || "MCP agent";
  try {
    const comment = await deps.github.commentOnIssue(
      input.repo,
      input.issue,
      formatDecision({ item: input.item?.trim() || "not specified", decision: text, by, date: today(deps) }),
    );
    return { ok: true, body: { issue_comment: comment.url } };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return { ok: false, status: 404, error: err.message };
    return upstreamFailure(err, "GitHub write failed");
  }
}
