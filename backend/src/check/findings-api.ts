import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { listFindings, setFindingState, type PoolLike } from "./store.js";

export interface FindingsApiDeps {
  pool: PoolLike;
  apiKey: string;
  frontendOrigin: string;
}

function keyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const FINDING_STATES = new Set(["open", "approved", "dismissed"]);

/** #18 — GET /findings + PATCH /findings/:id/state, API-key gated, CORS-locked. */
export function findingsApi(deps: FindingsApiDeps): Hono {
  const api = new Hono();

  api.use("*", cors({ origin: deps.frontendOrigin }));
  api.use("*", async (c, next) => {
    if (!keyMatches(c.req.header("x-api-key"), deps.apiKey)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  api.get("/", async (c) => {
    const state = c.req.query("state");
    if (state !== undefined && !FINDING_STATES.has(state)) {
      return c.json({ error: "invalid state" }, 400);
    }
    return c.json(await listFindings(deps.pool, state));
  });

  api.patch("/:id/state", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid body" }, 400);
    }
    const state = (body as { state?: unknown }).state;
    if (state !== "approved" && state !== "dismissed") {
      return c.json({ error: "state must be approved or dismissed" }, 400);
    }
    const found = await setFindingState(deps.pool, c.req.param("id"), state);
    return found ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  return api;
}
