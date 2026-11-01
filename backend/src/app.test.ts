import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("GET /health", () => {
  it("returns 200 with ok", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s on unknown routes", async () => {
    const res = await createApp().request("/nope");
    expect(res.status).toBe(404);
  });
});
