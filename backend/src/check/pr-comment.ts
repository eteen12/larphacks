import type { CheckContext, CheckStage } from "./run-check.js";
import type { GitHubWriter } from "../actions/github.js";

/**
 * #19 — the one PR comment body. The `<!-- drift-guard -->` marker is added by
 * github.ts's upsertPrComment, so this returns the body only.
 * A failed run must never produce "no drift" — it says the check failed.
 */
export function formatComment(ctx: CheckContext): string {
  const lines: string[] = ["## Drift Guard"];
  if (ctx.error) {
    lines.push(
      "",
      `**Drift check failed — no result.** This is not a clean pass; investigate before merging.`,
      "",
      `\`${ctx.error.message}\``,
    );
    return lines.join("\n");
  }

  const findings = ctx.findings ?? [];
  if (findings.length === 0) {
    lines.push("", "No drift found.");
    return lines.join("\n");
  }

  lines.push("", `**${findings.length} drift finding${findings.length === 1 ? "" : "s"}** on this head:`, "");
  for (const f of findings) {
    const label = f.kind === "conflict" ? "conflict" : "no source";
    lines.push(`- **${f.item}** (${label}, confidence ${f.confidence.toFixed(2)})`);
    lines.push(`  - Issue: “${f.issue_quote}”`);
    if (f.note_quote) {
      lines.push(`  - Vault \`${f.note_path}\` (${f.note_date}): “${f.note_quote}”`);
    } else {
      lines.push(`  - No vault source found for this decision`);
    }
    lines.push(`  - Diff: \`${f.diff_line}\``);
  }

  const searches = ctx.agentResult?.searches ?? [];
  const notes = ctx.agentResult?.notesRead ?? [];
  lines.push(
    "",
    `<details><summary>Agent evidence — ${searches.length} searches, ${notes.length} vault notes read</summary>`,
    "",
  );
  for (const s of searches) lines.push(`- search: \`${s}\``);
  for (const n of notes) lines.push(`- read: \`${n}\``);
  if (searches.length === 0 && notes.length === 0) lines.push("- none recorded");
  lines.push("", "</details>");
  return lines.join("\n");
}

/** #19 — upsert the single drift-guard comment; never writes GitHub directly. */
export function commentStage(deps: { github: GitHubWriter }): CheckStage {
  return {
    name: "comment",
    async run(ctx) {
      if (ctx.discarded) return;
      const repo = `${ctx.job.owner}/${ctx.job.repo}`;
      try {
        await deps.github.upsertPrComment(repo, ctx.job.prNumber, formatComment(ctx));
      } catch (err) {
        // Findings are already persisted; losing the comment must not fail the run.
        console.error(`drift comment upsert failed for ${repo}#${ctx.job.prNumber}`, err);
      }
    },
  };
}
