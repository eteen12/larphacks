import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CheckJob } from "./queue.js";

const execFileAsync = promisify(execFile);

export interface Workspace {
  dir: string;
  codeDir: string;
  vaultDir: string;
  githubDir: string;
}

export interface WorkspaceDeps {
  /** Read token, sent as an http.extraHeader so it never lands in .git/config. */
  githubToken?: string;
  /** "owner/repo" — shallow-cloned on its default branch. */
  vaultRepo: string;
  /** Resolve the code remote for a job. Default: https://github.com/<owner>/<repo>.git */
  codeUrl?: (job: CheckJob) => string;
  /** Resolve the vault remote. Default: https://github.com/<vaultRepo>.git */
  vaultUrl?: (repo: string) => string;
}

const defaultUrl = (slug: string) => `https://github.com/${slug}.git`;

async function git(args: string[], cwd?: string, token?: string): Promise<void> {
  const auth = token ? ["-c", `http.extraHeader=Authorization: Bearer ${token}`] : [];
  try {
    await execFileAsync("git", [...auth, ...args], { cwd });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

/** Fetch exactly the PR head commit; fails cleanly when it no longer exists (force-push). */
async function cloneCode(
  url: string,
  headSha: string,
  dest: string,
  token?: string,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  await git(["init", "-q"], dest);
  await git(["remote", "add", "origin", url], dest);
  await git(["fetch", "-q", "--depth", "1", "origin", headSha], dest, token);
  await git(["checkout", "-q", "FETCH_HEAD"], dest);
}

/** Create /tmp/drift-<id>/{code,vault,github}; any failure removes the folder. */
export async function createWorkspace(
  deps: WorkspaceDeps,
  job: CheckJob,
): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), "drift-"));
  const ws: Workspace = {
    dir,
    codeDir: join(dir, "code"),
    vaultDir: join(dir, "vault"),
    githubDir: join(dir, "github"),
  };
  await mkdir(ws.githubDir, { recursive: true });
  try {
    await cloneCode(
      (deps.codeUrl ?? ((j: CheckJob) => defaultUrl(`${j.owner}/${j.repo}`)))(job),
      job.headSha,
      ws.codeDir,
      deps.githubToken,
    );
    await git(
      ["clone", "-q", "--depth", "1", (deps.vaultUrl ?? defaultUrl)(deps.vaultRepo), ws.vaultDir],
      undefined,
      deps.githubToken,
    );
  } catch (err) {
    await destroyWorkspace(ws).catch(() => {});
    throw err;
  }
  return ws;
}

export async function destroyWorkspace(ws: Workspace): Promise<void> {
  await rm(ws.dir, { recursive: true, force: true });
}
