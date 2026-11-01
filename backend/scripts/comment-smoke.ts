import { createGitHub } from "../src/actions/github.js";
import { formatComment } from "../src/check/pr-comment.js";
import type { CheckContext } from "../src/check/run-check.js";

const gh = createGitHub({ token: process.env.GH_TOKEN! });
const ctx: CheckContext = {
  job: { owner: "eteen12", repo: "larphacks", prNumber: 46, headSha: "x", issueNumber: 2, enqueuedAt: 0 },
  cleanups: [],
  findings: [{
    id: "demo1", repo: "eteen12/larphacks", pr: 46, issue: 2, item: "demo finding",
    kind: "conflict", issue_quote: "issue says X", note_quote: "vault says Y",
    note_path: "vault/demo.md", note_date: "2026-11-01", diff_line: "+line",
    confidence: 0.85, searches: ["grep demo"], state: "open",
    head_sha: "x", created_at: "2026-11-01T00:00:00Z",
  }],
  agentResult: { finalText: "{}", searches: ["grep demo"], notesRead: ["vault/demo.md"], toolsUsed: [], turns: 1 },
};

const r1 = await gh.upsertPrComment("eteen12/larphacks", 46, formatComment(ctx));
console.log("first:", JSON.stringify(r1));
const r2 = await gh.upsertPrComment("eteen12/larphacks", 46, formatComment(ctx) + "\n\n(updated)");
console.log("second:", JSON.stringify(r2), "same id:", r1.id === r2.id);
