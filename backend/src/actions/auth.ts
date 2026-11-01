import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/** Requires x-api-key to match FINDINGS_API_KEY (same key as the findings API, #18). */
export function requireApiKey(apiKey: string): MiddlewareHandler {
  if (!apiKey) throw new Error("FINDINGS_API_KEY is not set");
  const expected = Buffer.from(apiKey);
  return async (c, next) => {
    const given = Buffer.from(c.req.header("x-api-key") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return c.json({ error: "Missing or wrong x-api-key" }, 401);
    }
    await next();
  };
}
