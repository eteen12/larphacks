import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { CheckQueue } from "./check/queue.js";

function testApp() {
  return createApp({
    webhook: {
      webhookSecret: "test-secret",
      queue: new CheckQueue(async () => {}),
      resolveLinkedTask: async () => null,
    },
  });
}

describe("GET /health", () => {
  it("returns 200 with ok", async () => {
    const res = await testApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s on unknown routes", async () => {
    const res = await testApp().request("/nope");
    expect(res.status).toBe(404);
  });
});
