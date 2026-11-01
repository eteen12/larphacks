import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createRunCheck } from "./run-check.js";
import { workspaceStage } from "./stages.js";
import { authHeader, createWorkspace, destroyWorkspace, gitAuthEnv } from "./workspace.js";
import type { CheckJob } from "./queue.js";

const exec = promisify(execFile);
const scratch: string[] = [];

async function gitIn(cwd: string, ...args: string[]) {
  return exec("git", args, { cwd });
}

async function makeRepo(): Promise<{ dir: string; url: string; sha1: string; sha2: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dg-fixture-"));
  scratch.push(dir);
  await gitIn(dir, "init", "-q");
  await gitIn(dir, "config", "user.email", "t@t");
  await gitIn(dir, "config", "user.name", "t");
  await writeFile(join(dir, "file.txt"), "v1");
  await gitIn(dir, "add", ".");
  await gitIn(dir, "commit", "-qm", "one");
  const sha1 = (await gitIn(dir, "rev-parse", "HEAD")).stdout.trim();
  await writeFile(join(dir, "file.txt"), "v2");
  await gitIn(dir, "add", ".");
  await gitIn(dir, "commit", "-qm", "two");
  const sha2 = (await gitIn(dir, "rev-parse", "HEAD")).stdout.trim();
  return { dir, url: `file:///${dir.replaceAll("\\", "/")}`, sha1, sha2 };
}

/** drift-* dirs present in tmpdir — used to prove failures leave nothing behind. */
async function driftDirs(): Promise<Set<string>> {
  return new Set((await readdir(tmpdir())).filter((d) => d.startsWith("drift-")));
}

const job = (sha: string): CheckJob => ({
  owner: "x",
  repo: "y",
  prNumber: 1,
  headSha: sha,
  issueNumber: 7,
  enqueuedAt: 0,
});

afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

describe("createWorkspace", () => {
  it("creates the run folder with code at the PR head commit and the vault", async () => {
    const code = await makeRepo();
    const vault = await makeRepo();
    const ws = await createWorkspace(
      { vaultRepo: "v/v", codeUrl: () => code.url, vaultUrl: () => vault.url },
      job(code.sha2),
    );
    scratch.push(ws.dir);

    expect(ws.dir).toMatch(/drift-/);
    expect(await readFile(join(ws.codeDir, "file.txt"), "utf8")).toBe("v2");
    expect(await readFile(join(ws.vaultDir, "file.txt"), "utf8")).toBe("v2");
    await stat(ws.githubDir); // exists
  });

  it("checks out the exact requested sha, not the branch tip", async () => {
    const code = await makeRepo();
    const vault = await makeRepo();
    const ws = await createWorkspace(
      { vaultRepo: "v/v", codeUrl: () => code.url, vaultUrl: () => vault.url },
      job(code.sha1),
    );
    scratch.push(ws.dir);
    expect(await readFile(join(ws.codeDir, "file.txt"), "utf8")).toBe("v1");
  });

  it("fails cleanly and removes the folder when the sha is gone (force-push)", async () => {
    const code = await makeRepo();
    const vault = await makeRepo();
    const before = await driftDirs();
    await expect(
      createWorkspace(
        { vaultRepo: "v/v", codeUrl: () => code.url, vaultUrl: () => vault.url },
        job("0".repeat(40)),
      ),
    ).rejects.toThrow();
    expect(await driftDirs()).toEqual(before);
  });

  it("fails cleanly and removes the folder when the vault clone fails", async () => {
    const code = await makeRepo();
    const before = await driftDirs();
    await expect(
      createWorkspace(
        {
          vaultRepo: "v/v",
          codeUrl: () => code.url,
          vaultUrl: () => "file:///no/such/vault-repo",
        },
        job(code.sha2),
      ),
    ).rejects.toThrow();
    expect(await driftDirs()).toEqual(before);
  });
});

describe("workspace stage cleanup", () => {
  it("removes the run folder when a later stage fails", async () => {
    const code = await makeRepo();
    const vault = await makeRepo();
    let seenDir = "";
    const run = createRunCheck([
      workspaceStage({ vaultRepo: "v/v", codeUrl: () => code.url, vaultUrl: () => vault.url }),
      {
        name: "boom",
        run: async (ctx) => {
          seenDir = ctx.workspace!.dir;
          throw new Error("later stage failed");
        },
      },
    ]);
    await expect(run(job(code.sha2))).rejects.toThrow("later stage failed");
    await expect(stat(seenDir)).rejects.toThrow();
  });

  it("removes the run folder after a successful run", async () => {
    const code = await makeRepo();
    const vault = await makeRepo();
    let seenDir = "";
    const run = createRunCheck([
      workspaceStage({ vaultRepo: "v/v", codeUrl: () => code.url, vaultUrl: () => vault.url }),
      {
        name: "peek",
        run: async (ctx) => {
          seenDir = ctx.workspace!.dir;
        },
      },
    ]);
    await run(job(code.sha2));
    await expect(stat(seenDir)).rejects.toThrow();
  });
});

describe("clone auth", () => {
  const token = "ghp_SECRETTOKEN123";

  it("builds a Basic x-access-token header, not Bearer", () => {
    const h = authHeader(token);
    expect(h).toBe(
      `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    );
    expect(h).not.toMatch(/Bearer/);
  });

  it("scopes the header to the https origin via env, never argv", () => {
    const env = gitAuthEnv("https://github.com/o/r.git", token);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(authHeader(token));
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("sends no header for non-https remotes or when there is no token", () => {
    expect(gitAuthEnv("file:///x", token).GIT_CONFIG_COUNT).toBeUndefined();
    expect(gitAuthEnv("https://github.com/o/r.git").GIT_CONFIG_COUNT).toBeUndefined();
  });

  it("names the repo with the status on 401 and never leaks the token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dg-bin-"));
    scratch.push(dir);
    const fake = join(dir, "git");
    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    await writeFile(
      fake,
      `#!/bin/sh\necho "remote: Invalid username or password. ${token} ${b64}" >&2\necho "fatal: Authentication failed for 'https://github.com/o/r.git/'" >&2\nexit 128\n`,
      { mode: 0o755 },
    );
    const oldPath = process.env.PATH;
    process.env.PATH = `${dir}:${oldPath}`;
    const before = await driftDirs();
    try {
      const err = await createWorkspace(
        { githubToken: token, vaultRepo: "o/vault" },
        job("a".repeat(40)),
      ).catch((e: Error) => e);
      expect((err as Error).message).toBe("clone failed (401) for x/y");
      expect(String((err as Error).stack)).not.toContain(token);
      expect(String((err as Error).stack)).not.toContain(b64);
    } finally {
      process.env.PATH = oldPath;
    }
    expect(await driftDirs()).toEqual(before);
  });
});
