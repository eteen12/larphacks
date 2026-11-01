import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createChecksApi, FakeCheckRequester } from "./actions/checks";
import { fixtureFindings } from "./actions/fixtures";
import { createFindingsApiStore, FakeFindingsStore } from "./actions/findings-store";
import { createGitHubFromEnv } from "./actions/github";

const env = process.env;
const apiKey = env.FINDINGS_API_KEY?.trim();
if (!apiKey) throw new Error("FINDINGS_API_KEY is not set");

// Fails here, at startup, if GITHUB_WRITE_TOKEN is missing.
const github = createGitHubFromEnv(env);

const findings = env.FINDINGS_API_URL
  ? createFindingsApiStore({ baseUrl: env.FINDINGS_API_URL, apiKey })
  : (console.warn("FINDINGS_API_URL not set: using the in-memory fake findings store"), new FakeFindingsStore(fixtureFindings));
const checks = env.CHECKS_API_URL
  ? createChecksApi({ baseUrl: env.CHECKS_API_URL, apiKey })
  : (console.warn("CHECKS_API_URL not set: re-check requests are only recorded in memory"), new FakeCheckRequester());

const port = Number(env.PORT ?? 8787);
serve({ fetch: createApp({ github, findings, checks }, { apiKey }).fetch, port });
console.log(`drift-guard backend listening on :${port}`);
