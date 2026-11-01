import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AgentRunError, runAgent, StreamAccumulator } from "./agent.js";

const FAKE = ["node", fileURLToPath(new URL("../../test/fake-claude.mjs", import.meta.url))];
const scratch: string[] = [];

afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dg-agent-"));
  scratch.push(dir);
  return dir;
}

describe("StreamAccumulator", () => {
  it("records tool calls, searches and vault reads from real event shapes", () => {
    const acc = new StreamAccumulator();
    acc.push(JSON.stringify({ type: "system", subtype: "init", session_id: "s9" }));
    acc.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Grep", input: { pattern: "53%|margin" } },
            { type: "tool_use", name: "Glob", input: { pattern: "vault/**/*.md" } },
            { type: "tool_use", name: "Read", input: { file_path: "vault/a.md" } },
            { type: "tool_use", name: "Read", input: { file_path: "C:\\run\\vault\\b.md" } },
            { type: "tool_use", name: "Read", input: { file_path: "github/issue.md" } },
          ],
        },
      }),
    );
    acc.push(
      JSON.stringify({ type: "result", subtype: "success", result: "{}", num_turns: 2 }),
    );
    const r = acc.finish();
    expect(r.searches).toEqual(["53%|margin", "vault/**/*.md"]);
    expect(r.notesRead).toEqual(["vault/a.md", "C:\\run\\vault\\b.md"]);
    expect(r.toolsUsed).toEqual(["Grep", "Glob", "Read"]);
    expect(r.turns).toBe(2);
    expect(r.finalText).toBe("{}");
  });

  it("ignores non-JSON noise lines", () => {
    const acc = new StreamAccumulator();
    acc.push("some plain log line");
    acc.push(JSON.stringify({ type: "result", result: "ok", num_turns: 1 }));
    expect(acc.finish().finalText).toBe("ok");
  });

  it("throws on an errored result", () => {
    const acc = new StreamAccumulator();
    acc.push(
      JSON.stringify({ type: "result", result: "Failed to authenticate", is_error: true }),
    );
    expect(() => acc.finish()).toThrow(AgentRunError);
  });

  it("throws when the agent never produced a final answer", () => {
    const acc = new StreamAccumulator();
    acc.push(JSON.stringify({ type: "system", subtype: "init" }));
    expect(() => acc.finish()).toThrow("no final answer");
  });
});

describe("runAgent", () => {
  it("returns the final answer plus actual searches and notes read", async () => {
    const r = await runAgent({ prompt: "p", cwd: await tmpCwd(), claudeCmd: FAKE });
    expect(r.finalText).toContain('"findings"');
    expect(r.searches).toEqual(["discount|margin"]);
    expect(r.notesRead).toEqual(["vault/notes/2026-10-28.md"]);
    expect(r.turns).toBe(3);
  });

  it("passes --model: haiku by default, CHECK_MODEL or the model option when set", async () => {
    const argvOf = async (model?: string, env?: string) => {
      const prev = process.env.CHECK_MODEL;
      if (env === undefined) delete process.env.CHECK_MODEL;
      else process.env.CHECK_MODEL = env;
      try {
        const r = await runAgent({
          prompt: "p",
          cwd: await tmpCwd(),
          claudeCmd: FAKE,
          env: { FIXTURE_SCENARIO: "argv" },
          model,
        });
        return JSON.parse(r.finalText) as string[];
      } finally {
        if (prev === undefined) delete process.env.CHECK_MODEL;
        else process.env.CHECK_MODEL = prev;
      }
    };
    const flag = (a: string[]) => a[a.indexOf("--model") + 1];
    expect(flag(await argvOf())).toBe("haiku");
    expect(flag(await argvOf(undefined, "sonnet"))).toBe("sonnet");
    expect(flag(await argvOf("opus", "sonnet"))).toBe("opus");
  });

  it("timeout kills the run = failed run", async () => {
    await expect(
      runAgent({
        prompt: "p",
        cwd: await tmpCwd(),
        claudeCmd: FAKE,
        env: { FIXTURE_SCENARIO: "hang" },
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/timed out|exited|no final answer/);
  }, 15000);

  it("no final answer = failed run", async () => {
    await expect(
      runAgent({
        prompt: "p",
        cwd: await tmpCwd(),
        claudeCmd: FAKE,
        env: { FIXTURE_SCENARIO: "noanswer" },
      }),
    ).rejects.toThrow(AgentRunError);
  });

  it("agent-side error result = failed run", async () => {
    await expect(
      runAgent({
        prompt: "p",
        cwd: await tmpCwd(),
        claudeCmd: FAKE,
        env: { FIXTURE_SCENARIO: "error" },
      }),
    ).rejects.toThrow("Failed to authenticate");
  });
});
