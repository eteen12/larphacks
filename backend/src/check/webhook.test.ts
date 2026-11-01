import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { CheckQueue, type CheckJob } from "./queue.js";
import type { PrRef } from "./linked-task.js";

const SECRET = "test-secret";

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function prPayload(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    pull_request: {
      number: 42,
      body: "Closes #7",
      head: { sha: "abc123", ref: "7-some-task" },
      ...overrides,
    },
    repository: { name: "demo-repo", owner: { login: "eteen12" } },
  };
}

async function post(
  app: ReturnType<typeof createApp>,
  body: object,
  headers: Record<string, string> = {},
) {
  const raw = JSON.stringify(body);
  return app.request("/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": sign(SECRET, raw),
      ...headers,
    },
    body: raw,
  });
}

function setup(linked: number | null = 7) {
  const ran: CheckJob[] = [];
  const queue = new CheckQueue(async (j) => void ran.push(j));
  const app = createApp({
    webhook: {
      webhookSecret: SECRET,
      queue,
      resolveLinkedTask: vi.fn(async (_pr: PrRef) => linked),
    },
  });
  return { app, queue, ran };
}

describe("POST /webhooks/github", () => {
  it("rejects a missing signature with 401", async () => {
    const { app, queue } = setup();
    const res = await post(app, prPayload("opened"), { "x-hub-signature-256": "" });
    expect(res.status).toBe(401);
    await queue.idle();
  });

  it("rejects a bad signature with 401", async () => {
    const { app } = setup();
    const res = await post(app, prPayload("opened"), {
      "x-hub-signature-256": "sha256=deadbeef",
    });
    expect(res.status).toBe(401);
  });

  it("rejects everything when the secret is not configured", async () => {
    const app = createApp({
      webhook: {
        webhookSecret: "",
        queue: new CheckQueue(async () => {}),
        resolveLinkedTask: async () => 7,
      },
    });
    const res = await post(app, prPayload("opened"));
    expect(res.status).toBe(401);
  });

  it("ignores non-pull_request events with 200", async () => {
    const { app } = setup();
    const res = await post(app, prPayload("opened"), {
      "x-github-event": "push",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });

  it("ignores unhandled pull_request actions with 200", async () => {
    const { app } = setup();
    const res = await post(app, prPayload("closed"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
  });

  it.each(["opened", "synchronize", "reopened"])(
    "queues one check for action %s on a linked PR",
    async (action) => {
      const { app, queue, ran } = setup(7);
      const res = await post(app, prPayload(action));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ queued: true, reason: "queued" });
      await queue.idle();
      expect(ran).toHaveLength(1);
      expect(ran[0]).toMatchObject({
        owner: "eteen12",
        repo: "demo-repo",
        prNumber: 42,
        headSha: "abc123",
        issueNumber: 7,
      });
    },
  );

  it("skips an unlinked PR", async () => {
    const { app, queue, ran } = setup(null);
    const res = await post(app, prPayload("opened"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: false, reason: "unlinked" });
    await queue.idle();
    expect(ran).toHaveLength(0);
  });

  it("dedupes a retried delivery", async () => {
    const { app, queue, ran } = setup(7);
    const payload = prPayload("opened");
    await post(app, payload);
    const res = await post(app, payload);
    expect(await res.json()).toEqual({ queued: false, reason: "duplicate" });
    await queue.idle();
    expect(ran).toHaveLength(1);
  });

  it("dedupes the same head on a new delivery", async () => {
    const { app, queue, ran } = setup(7);
    await post(app, prPayload("opened"));
    const res = await post(app, prPayload("synchronize"), {
      "x-github-delivery": "delivery-2",
    });
    expect(await res.json()).toEqual({ queued: false, reason: "duplicate" });
    await queue.idle();
    expect(ran).toHaveLength(1);
  });

  it("queues the newer head when two pushes arrive", async () => {
    const { app, queue, ran } = setup(7);
    await post(app, prPayload("opened"));
    const res = await post(
      app,
      prPayload("synchronize", { head: { sha: "def456", ref: "7-some-task" } }),
      { "x-github-delivery": "delivery-2" },
    );
    expect(await res.json()).toEqual({ queued: true, reason: "queued" });
    await queue.idle();
    expect(ran).toHaveLength(2);
    expect(ran[1].headSha).toBe("def456");
  });
});
