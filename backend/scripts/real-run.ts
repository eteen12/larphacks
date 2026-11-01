// One-off real runs against the demo repo, for the close-out links on #22, #23, #24, #26 and #27.
// Usage (from backend/, with GITHUB_WRITE_TOKEN and DEMO_REPO set):
//   npm run real-run -- github  --issue 12 --pr 40 --sha <head sha of PR 40>
//   npm run real-run -- approve --issue 12 --pr 40 --instruction "Change the discount to 8%"
//   npm run real-run -- dismiss --issue 12 --pr 40 --note "5% confirmed by the client" --sha <head sha>
// approve/dismiss use a throwaway finding in the in-memory store, so the findings API is not needed.
import { parseArgs } from "node:util";
import { approveFinding, dismissFinding } from "../src/actions/decisions";
import { fixtureFindings } from "../src/actions/fixtures";
import { FakeFindingsStore } from "../src/actions/findings-store";
import { createGitHubFromEnv } from "../src/actions/github";

const FORBIDDEN = ["eteen12/larphacks"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    issue: { type: "string" },
    pr: { type: "string" },
    sha: { type: "string" },
    instruction: { type: "string" },
    note: { type: "string" },
  },
});

const repo = process.env.DEMO_REPO?.trim() ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Set DEMO_REPO to the demo repo (owner/name)");
if (FORBIDDEN.includes(repo.toLowerCase())) throw new Error(`Refusing to write to ${repo}: real runs go to the demo repo only`);

const issue = Number(values.issue);
const pr = Number(values.pr);
if (!issue || !pr) throw new Error("--issue and --pr are required");

const github = createGitHubFromEnv();
const command = positionals[0];
console.log(`Real run "${command}" on ${repo} issue #${issue} PR #${pr}`);

if (command === "github") {
  if (!values.sha) throw new Error("--sha is required");
  console.log("#22 reopenIssue:", await github.reopenIssue(repo, issue));
  console.log("#22 commentOnIssue:", await github.commentOnIssue(repo, issue, "Drift guard real-run test comment (#22)."));
  console.log("#23 upsertPrComment 1:", await github.upsertPrComment(repo, pr, "Drift guard real-run test (#23), first write."));
  console.log("#23 upsertPrComment 2:", await github.upsertPrComment(repo, pr, "Drift guard real-run test (#23), edited."));
  console.log("#24 setCommitStatus:", await github.setCommitStatus(repo, values.sha, "success", "Drift guard real-run test (#24)"));
  console.log(`Status list: https://github.com/${repo}/commit/${values.sha}`);
} else if (command === "approve" || command === "dismiss") {
  const finding = { ...fixtureFindings[0]!, id: `real-run-${Date.now()}`, repo, issue, pr, state: "open" as const };
  const deps = { github, findings: new FakeFindingsStore([finding], values.sha ? { [finding.id]: values.sha } : {}) };
  const result =
    command === "approve"
      ? await approveFinding(deps, { findingId: finding.id, instruction: values.instruction ?? "Change the slow-season discount to 8%", by: "real-run" })
      : await dismissFinding(deps, { findingId: finding.id, note: values.note, by: "real-run" });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  throw new Error('Command must be "github", "approve" or "dismiss"');
}
