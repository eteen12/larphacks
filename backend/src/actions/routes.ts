// POST /findings/:id/approve and POST /findings/:id/dismiss (#26, #27), called by the inbox (#3).
import { Hono, type Context } from "hono";
import { requireApiKey } from "./auth";
import { approveFinding, dismissFinding, type ActionDeps, type ActionResult } from "./decisions";

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function respond<T>(c: Context, result: ActionResult<T>) {
  return result.ok ? c.json(result.body, 200) : c.json({ error: result.error }, result.status);
}

export function createActionRoutes(deps: ActionDeps, apiKey: string): Hono {
  const app = new Hono();
  app.use("/findings/:id/approve", requireApiKey(apiKey));
  app.use("/findings/:id/dismiss", requireApiKey(apiKey));

  app.post("/findings/:id/approve", async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: "Body must be a JSON object" }, 400);
    const by = typeof body.by === "string" ? body.by : undefined;
    return respond(c, await approveFinding(deps, { findingId: c.req.param("id"), instruction: body.instruction, by }));
  });

  app.post("/findings/:id/dismiss", async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: "Body must be a JSON object" }, 400);
    const by = typeof body.by === "string" ? body.by : undefined;
    return respond(c, await dismissFinding(deps, { findingId: c.req.param("id"), note: body.note, by }));
  });

  return app;
}
