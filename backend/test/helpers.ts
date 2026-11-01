import { createApp } from "../src/app";
import { FakeCheckRequester } from "../src/actions/checks";
import type { ActionDeps } from "../src/actions/decisions";
import { DEMO_REPO, fixtureFindings } from "../src/actions/fixtures";
import { FakeFindingsStore } from "../src/actions/findings-store";
import { FakeGitHub } from "../src/actions/github.fake";

export const API_KEY = "test-key";
export const REPO = DEMO_REPO;
export const NOW = new Date("2026-10-28T15:00:00Z");

export function setup() {
  // Issue #12 is closed (it was shipped), PR #40 is the drifted PR, #15 and #41 belong to another task.
  const github = new FakeGitHub().addIssue(REPO, 12, "closed").addIssue(REPO, 40, "open").addIssue(REPO, 15, "closed").addIssue(REPO, 41, "open");
  const findings = new FakeFindingsStore(fixtureFindings);
  const checks = new FakeCheckRequester();
  const deps: ActionDeps = { github, findings, checks, now: () => NOW };
  const app = createApp(deps, { apiKey: API_KEY });

  async function post(path: string, body?: unknown, key: string | null = API_KEY) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key === null ? {} : { "x-api-key": key }) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  return { github, findings, checks, deps, app, post };
}
