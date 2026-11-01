import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DismissedFinding } from "./store.js";

function quote(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "> (empty)";
  return t.split("\n").map((l) => `> ${l}`).join("\n");
}

function entry(f: DismissedFinding): string {
  const note = f.note_quote
    ? `${quote(f.note_quote)}\n${[f.note_path, f.note_date].filter(Boolean).join(", ")}`.trimEnd()
    : "> (no note — nothing in the vault backed it)";
  const code = f.diff_line?.trim() ? `\n\nCode:\n${quote(f.diff_line)}` : "";
  return `## ${f.item}

Dismissed: ${f.dismissed_at ?? "unknown"}

Issue said:
${quote(f.issue_quote)}${code}

Note said:
${note}
`;
}

/** Text of github/decisions.md for one issue's dismissed findings. */
export function decisionsMd(findings: DismissedFinding[]): string {
  if (!findings.length) return "No dismissed findings\n";
  return `# Already dismissed for this issue

Each entry below was reviewed and dismissed. It is already settled; do not report it again.

${findings.map(entry).join("\n")}`;
}

export async function writeDecisions(githubDir: string, findings: DismissedFinding[]): Promise<void> {
  await writeFile(join(githubDir, "decisions.md"), decisionsMd(findings));
}
