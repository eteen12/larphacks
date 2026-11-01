# Drift guard backend: GitHub actions and MCP (#4)

Backend only. `src/actions/github.ts` is the only code that writes to GitHub.

```bash
cd backend
npm install
npm test           # Vitest, no network
npm run typecheck
FINDINGS_API_KEY=... GITHUB_WRITE_TOKEN=... npm start   # :8787
```

## Layout
| Path | Issue | What |
|---|---|---|
| `src/actions/github.ts` | #22–#24 | `reopenIssue`, `commentOnIssue`, `upsertPrComment`, `setCommitStatus` |
| `src/actions/github.fake.ts` | #21 | Records every call for tests |
| `src/actions/decisions.ts` | #25 | Approve, dismiss and record logic shared by HTTP and MCP |
| `src/actions/routes.ts` | #26, #27 | `POST /findings/:id/approve`, `POST /findings/:id/dismiss` |
| `src/mcp/server.ts` | #31–#33 | `/mcp`: `get_drift`, `record_decision`, `approve`, `dismiss` |
| `src/actions/findings-store.ts`, `checks.ts` | — | Fakes plus HTTP clients for #18 and #9 |
| `scripts/real-run.ts` | — | Real runs on the demo repo for close-out links |
| `demo-repo/claude.yml` | #29 | Fix workflow to copy into the demo repo |

## Integration notes (for Ethan)
- `src/finding.ts` is a local copy of the #1 shape; swap for `shared/finding.ts`.
- Approve, dismiss and MCP read and update findings straight from Postgres (`createDbFindingsStore`); there is no findings URL to configure.
- `createApp(deps, { apiKey })` in `src/app.ts` mounts the routes and `/mcp`; #7's app can `app.route("/", ...)` the same pieces.
- Connect Claude Code: `claude mcp add --transport http drift-guard https://<host>/mcp --header "x-api-key: <key>"`.
