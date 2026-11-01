import type { Context } from "hono";
import { verifyWebhookSignature } from "./signature.js";
import type { CheckQueue } from "./queue.js";
import type { PrRef } from "./linked-task.js";

export interface WebhookDeps {
  webhookSecret: string;
  queue: CheckQueue;
  resolveLinkedTask: (pr: PrRef) => Promise<number | null>;
}

const CHECKED_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

interface PullRequestPayload {
  action?: string;
  pull_request?: {
    number: number;
    body?: string | null;
    head?: { sha?: string; ref?: string };
  };
  repository?: { name?: string; owner?: { login?: string } };
}

export function githubWebhookHandler(deps: WebhookDeps) {
  return async (c: Context) => {
    // Signature first: verify the raw body before parsing or doing any work.
    const raw = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    if (!deps.webhookSecret || !verifyWebhookSignature(deps.webhookSecret, raw, signature)) {
      return c.json({ error: "bad signature" }, 401);
    }

    if (c.req.header("x-github-event") !== "pull_request") {
      return c.json({ ignored: true }, 200);
    }

    const payload = JSON.parse(raw) as PullRequestPayload;
    const pr = payload.pull_request;
    if (!payload.action || !CHECKED_ACTIONS.has(payload.action) || !pr) {
      return c.json({ ignored: true }, 200);
    }

    const owner = payload.repository?.owner?.login ?? "";
    const repo = payload.repository?.name ?? "";
    const issueNumber = await deps.resolveLinkedTask({
      owner,
      repo,
      number: pr.number,
      body: pr.body ?? null,
      headRefName: pr.head?.ref ?? "",
    });
    if (issueNumber === null) {
      console.log(`skip unlinked PR ${owner}/${repo}#${pr.number}`);
      return c.json({ queued: false, reason: "unlinked" }, 202);
    }

    const result = deps.queue.enqueue(c.req.header("x-github-delivery") ?? "", {
      owner,
      repo,
      prNumber: pr.number,
      headSha: pr.head?.sha ?? "",
      issueNumber,
    });
    return c.json({ queued: result === "queued", reason: result }, 202);
  };
}
