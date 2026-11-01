import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CheckJob } from "./queue.js";

export interface AgentResult {
  finalText: string;
  searches: string[];
  notesRead: string[];
  toolsUsed: string[];
  turns: number;
}

export class AgentRunError extends Error {}

export interface AgentDeps {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  maxTurns?: number;
  /** Model alias or id for `claude --model`; defaults to CHECK_MODEL, then "haiku". */
  model?: string;
  /** Full argv prefix for the harness; defaults to ["claude" | "claude.cmd"]. Tests inject a fake. */
  claudeCmd?: string[];
  /** Extra env for the child on top of process.env. */
  env?: Record<string, string>;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] };
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  session_id?: string;
}

/** Accumulates the agent's real tool calls and final answer from stream-json lines. */
export class StreamAccumulator {
  searches: string[] = [];
  notesRead: string[] = [];
  toolsUsed = new Set<string>();
  finalText: string | null = null;
  isError = false;
  turns = 0;
  sessionId: string | null = null;

  push(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: StreamEvent;
    try {
      ev = JSON.parse(trimmed) as StreamEvent;
    } catch {
      return; // non-JSON noise lines are ignored
    }
    if (ev.type === "system" && ev.session_id) this.sessionId = ev.session_id;

    if (ev.type === "assistant") {
      for (const block of ev.message?.content ?? []) {
        if (block.type !== "tool_use" || !block.name) continue;
        this.toolsUsed.add(block.name);
        const input = block.input ?? {};
        if (block.name === "Grep" || block.name === "Glob") {
          const pattern = input.pattern;
          if (typeof pattern === "string") this.searches.push(pattern);
        }
        if (block.name === "Read") {
          const file = input.file_path;
          if (typeof file === "string" && /(^|[\\/])vault[\\/]/.test(file)) {
            this.notesRead.push(file);
          }
        }
      }
    }

    if (ev.type === "result") {
      this.finalText = typeof ev.result === "string" ? ev.result : null;
      this.isError = ev.is_error === true;
      this.turns = ev.num_turns ?? 0;
    }
  }

  finish(): AgentResult {
    if (this.isError) {
      throw new AgentRunError(this.finalText ?? "agent run errored");
    }
    if (this.finalText === null) {
      throw new AgentRunError("agent returned no final answer");
    }
    return {
      finalText: this.finalText,
      searches: this.searches,
      notesRead: this.notesRead,
      toolsUsed: [...this.toolsUsed],
      turns: this.turns,
    };
  }
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_TURNS = 30;
export const DEFAULT_MODEL = "haiku";

/**
 * #14 — run `claude -p` on the run folder with only read tools.
 * Timeout, missing answer or agent error = failed run (throws).
 */
export async function runAgent(deps: AgentDeps): Promise<AgentResult> {
  const acc = new StreamAccumulator();
  const cmd = deps.claudeCmd ?? [process.platform === "win32" ? "claude.cmd" : "claude"];
  const child = spawn(
    cmd[0],
    [
      ...cmd.slice(1),
      "-p",
      deps.prompt,
      "--allowedTools",
      "Read,Grep,Glob",
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      String(deps.maxTurns ?? DEFAULT_MAX_TURNS),
      "--model",
      deps.model ?? (process.env.CHECK_MODEL?.trim() || DEFAULT_MODEL),
    ],
    { cwd: deps.cwd, env: { ...process.env, ...deps.env }, stdio: ["ignore", "pipe", "pipe"] },
  );

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => acc.push(line));

  let stderrTail = "";
  child.stderr.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  clearTimeout(timer);
  rl.close();

  if (exitCode === null) {
    throw new AgentRunError(`agent run timed out after ${timeoutMs}ms`);
  }
  if (acc.finalText === null && stderrTail) {
    throw new AgentRunError(`agent exited ${exitCode}: ${stderrTail.trim()}`);
  }
  return acc.finish();
}

export function agentJobPrompt(basePrompt: string, job: CheckJob): string {
  return `${basePrompt}\n\nPull request: ${job.owner}/${job.repo}#${job.prNumber}\nLinked issue: #${job.issueNumber}\nThe code is in ./code, the vault is in ./vault, the GitHub context is in ./github.`;
}
