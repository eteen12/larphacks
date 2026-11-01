import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createRunCheck } from "./run-check.js";
import { workspaceStage } from "./stages.js";
import { createWorkspace, destroyWorkspace } from "./workspace.js";
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
