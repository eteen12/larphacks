# Drift check — master plan

Scope: issues #1 (Product epic, context) and #2 `DG · Drift check` (my feature) on `eteen12/larphacks`.
Eleven leaf tasks across four components. Build order is sequential; every leaf is gated by a
test → verify → fix loop before the next begins.

## What we're building

When a PR opens on the demo repo, the app server runs one headless agent check: does the code
change + linked issue tree still match what the client said in the Obsidian vault? Disagreements
become **findings** in Postgres, one updating comment on the PR, and a `drift-guard` commit status
that blocks merge until resolved or dismissed.

Pipeline (one function `runCheck`, built stage by stage — each leaf adds a stage):

```
webhook → resolve task → clone → context files → agent run → validate → save → serve/comment/status
  #9        #8            #11        #12            #14         #15       #17    #18  #19  #20
```

## Repo layout (locked by #6)

```
larphacks/
├── backend/          # app server (Hono + TS + Node) → Railway
│   └── src/
│       ├── check/    # this feature (drift check)
│       ├── actions/  # #4 (ChikawaS04) adds routes here
│       └── mcp/      # #4
├── shared/           # contract files — OWNER: Ethan. finding.ts, check-output.ts
├── frontend/         # #3 (Heng2007) inbox → Vercel. We never touch it.
└── (existing Expo scaffold at root — moves into frontend/ later; not our job)
```

npm workspaces at root: `backend` + `shared` only. Backend never imports frontend; both import `shared/`.

Env vars (`.env.example` names only, never real values):
`GITHUB_TOKEN` (fine-grained PAT, read on demo+vault repos) · `GITHUB_WEBHOOK_SECRET` ·
`ANTHROPIC_API_KEY` · `DATABASE_URL` · `DEMO_REPO` · `VAULT_REPO` · `FINDINGS_API_KEY` · `FRONTEND_ORIGIN` (#3 supplies)

## Hard rules (from #1/#2 — the "do not" list)

- Agent harness is `claude -p` with **only Read, Grep, Glob** — no write, Bash, web, MCP, or GitHub access.
  Injection worst-case = a wrong verdict.
- Our code (not the agent) writes `github/` context files before the run.
- **Every** GitHub write goes through `github.ts` (#4). We never call the GitHub API directly for writes.
- Webhook answers fast (202) — never run a check inside the request.
- A failed run is **never** "no drift". Comment says "check failed"; status = error; store untouched.
- Each run replaces that PR's **open** findings only; approved/dismissed rows are never touched.
- No vault index/embeddings, no whole-repo context, no real client data, no code-review-for-bugs.
- Unlinked PRs → skip silently (one log line).

## Execution sequence + per-leaf gates

| Step | Issue | What it does | Gate (must all pass before next leaf) |
|---|---|---|---|
| 1 | #7 Scaffold app server | Hono app in `backend/`, `/health`, workspaces, `.env.example`, deploys to Railway, Claude CLI in image | `/health` 200 local + deployed; `claude --version` in Railway shell |
| 2 | #8 Find linked task | PR → issue number: GitHub linked-closing → `Closes/Fixes/Resolves #N` (any case) → branch prefix. Cross-repo Closes ignored; epic links OK; unlinked → null | Unit tests for every example + edge case in the issue |
| 3 | #9 Queue per PR head | Verify `X-Hub-Signature-256`; accept `opened`/`synchronize`/`reopened`; 202 immediately, check runs in bg; dedup by head SHA; stale runs discarded | Sig → 401; dup delivery → 1 check; rapid pushes → newest only; other actions → no-op; real demo PR queues in <1s |
| 4 | #11 Clone per run | `/tmp/drift-<id>/{code,vault,github}`; shallow clone code at head SHA + vault default branch; `finally` cleanup | No `/tmp/drift-*` left after success AND failure; vault-clone failure = failed run; force-push handled |
| 5 | #12 GitHub context files | `issue.md`, `parents.md` (nearest-first walk up), `board.md`, `pr.md`, `diff.patch`; comments keep author+date | No-parent/no-board write explicit text; verified by eye against #3 (parent #1) |
| 6 | #14 Run Claude read-only | `claude -p <prompt> --allowedTools "Read,Grep,Glob" --output-format stream-json`, cwd = run folder; parse stream → final answer + actual tool calls; 5-min + turn cap; placeholder prompt until Ethan's lands | Sample folder returns answer + non-empty search/vault-read lists; out-of-scope tool attempt refused; timeout/no-answer = failed run |
| 7 | #15 Validate output | Parse vs `shared/check-output.ts`; invalid → one retry with error → fail; confidence <0.7 dropped (=0.7 kept); findings stamped repo/pr/issue/head_sha + `state:"open"` + searches from #14 | Edge cases tested: zero findings = success, invalid×2 = fail, missing quote/diff_line rejected, unparseable ≠ "no drift" |
| 8 | #17 Save findings | One tx: delete PR's open findings, insert new; stale-run discard | Local Postgres tests: zero-finding clears open rows, failed run changes nothing, old run after new discarded, approved/dismissed preserved |
| 9 | #18 Findings API | `GET /findings` (+`?state=open`, newest first), `PATCH /:id/state`; `x-api-key` auth; CORS = `FRONTEND_ORIGIN` only | 401/404/400 cases; CORS allow/reject verified; curl on deployed API |
| 10 | #19 PR comment | One comment (`<!-- drift-guard -->` marker), updated in place; conflicts + no-source with quotes/dates/diff lines; collapsed searches list; via `github.ts` stub → real | Two pushes → same comment edited; failed-after-success shows "check failed" |
| 11 | #20 Commit status | `drift-guard` context: pending → failed(open findings)/passed(none)/error(failed run); count in description; via `github.ts` stub → real | Drift PR = failed + merge blocked (needs Ethan's branch protection); fix push = passed on new SHA |

## Per-leaf loop (the protocol)

For each leaf issue:

1. **Board**: mark In Progress on project #8.
2. **Implement** — one outcome, one PR worth of change.
3. **Run the issue's own Validation** — unit tests / route tests / Postgres / curl / demo-PR, per the body.
4. **Check every Acceptance criterion + Edge case + Do-not**, line by line.
5. **Fix → re-run** until all green. Done = checks pass, not "code looks right".
6. Typecheck + lint clean; no secrets; then mark **Done** on the board and take the next leaf.

## External dependencies (collect before they bite)

| Need | From | Blocks |
|---|---|---|
| `shared/finding.ts`, `shared/check-output.ts` | Ethan (#5) | #15 (hard) |
| `check-prompt.md` | Ethan (#5) | #14 placeholder until lands |
| `github.ts`: `upsertPrComment`, `setCommitStatus` | ChikawaS04 (#4, leaves #23/#24) | #19/#20 — local stub now, swap when lands |
| Railway project + `DATABASE_URL` + repo tokens | Ethan (#5) | #7 deploy, #17, live checks |
| Demo repo + vault repo exist | Ethan (#5) | #9/#11 real-PR validation (build vs public repos until then) |
| Branch protection on demo repo | Ethan (#5) | #20's merge-block check only |
| `FRONTEND_ORIGIN` value | Heng2007 (#3) | #18 config value only |

## Risks / watchpoints

- **Stale-run semantics** appear in three places (#9 dedup, #17 discard, #19 edit-in-place) — re-run those tests when integrating; a "done" leaf can silently break a later one here.
- **Postgres early**: need `docker run postgres` locally (or Railway `DATABASE_URL`) before #17, not at #17.
- **Prompt contract**: `claude --output-format stream-json` event shapes must be confirmed against the installed CLI version — verify on the very first #14 sample run, not by assumption.
- **Finding shape is frozen** per #1 — field names/types come from `shared/`, never re-declared in `backend/`.
- **Fail-closed everywhere**: vault clone fail, agent timeout, invalid output, older-run race — all = failed run, never silent "no drift".

## First leaf

**#7 — Scaffold the app server.** Only unblocked task; unblocks #8, #9, #11.
