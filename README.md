# Drift Guard

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Render](https://img.shields.io/badge/Render-000000?style=for-the-badge&logo=render&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)

**Your code passes the tests. It still might not be what the client asked for.**

I run an agency. Clients say stuff on calls, it ends up in our notes, and then a few weeks later the spec on GitHub says one thing, the code says another, and the client said something else entirely on a call nobody re-read. Tests don't catch that. Code review doesn't catch that. Agents writing the code definitely don't catch that.

Drift Guard does. Every pull request gets checked against what the client actually said.

## How it works

1. **A PR opens.** GitHub sends it to our backend.
2. **Claude checks it.** We clone the code, pull the linked issue (plus its parents and every comment), and clone the client's notes vault. Claude Code runs read-only (Read, Grep, Glob, nothing else), works out what the PR depends on, and searches the client's notes for each thing. Newest note wins.
3. **Drift gets flagged.** The PR gets a comment with the exact quotes ("Dana, Oct 28 pricing review: 12%" vs `slowSeasonDiscountPercent: 10`) and a red `drift-guard` status.
4. **You swipe on your phone.** Every finding shows up as a card.
   - **Swipe right:** it's drift. Type what should change, and we reopen the issue, record the decision, and comment `@claude` on the PR. Claude pushes the fix to that PR.
   - **Swipe left:** it's fine. The finding's marked dismissed, the PR goes green, and future checks won't flag it again.
5. **The fix gets re-checked.** New push, new check, green.

Agents can do all of this too through our MCP server (`get_drift`, `approve`, `dismiss`, `record_decision`), so a coding agent can ask "am I about to build the wrong thing?" before it starts.

## Demo

The demo client is Maple Ridge Painting (made up). On Oct 14 the owner said the slow-season discount was 10%. On Oct 28 she changed it to 12%. The GitHub issue still says 10%, so an agent builds 10% and every test passes.

Drift Guard catches it in about 25 seconds, the card hits the phone, one swipe, and Claude pushes the 12% fix.

## What's in here

```
backend/     Hono server: webhook, drift check, findings API, approve/dismiss, MCP
  src/check/   the check pipeline (clone → GitHub context → Claude → validate → save → comment + status)
  src/actions/ GitHub writes, approve/dismiss, findings store
  src/mcp/     MCP server
  check-prompt.md   what Claude is told to do
shared/      the finding type everything agrees on
src/         the Expo app (swipe inbox)
e2e/         Playwright test of the whole swipe flow
```

## Stack

- **Backend:** TypeScript, Node, Hono, Postgres, deployed on Render (Docker)
- **The check:** Claude Code in headless mode (`claude -p`) on Haiku, about 25 seconds and 1–2¢ per check
- **The fix:** `anthropics/claude-code-action` in the client repo, triggered by the `@claude` comment
- **App:** Expo (React Native), runs on a phone in Expo Go
- **Agents:** MCP server over streamable HTTP
- **Tests:** Vitest (250+ backend tests), Jest for the app, Playwright for the full swipe flow in a real browser on every PR

## Run it yourself

You'll need your own GitHub token, Claude token, a Postgres database, a repo to check, and a notes repo. Everything's listed in `backend/.env.example`.

```bash
cd backend && npm install && npm run dev   # backend on :3000, reads backend/.env.local
npm install && npx expo start              # app, reads .env.local (EXPO_PUBLIC_API_URL, EXPO_PUBLIC_FINDINGS_API_KEY)
```

## Team

Built at LARP Hacks by [Ethan](https://github.com/eteen12), [Eric](https://github.com/ChardXBT), [David](https://github.com/ChikawaS04) and [Heng](https://github.com/Heng2007).
