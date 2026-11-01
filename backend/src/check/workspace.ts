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

/** Basic auth header GitHub accepts for git over HTTPS (Bearer is rejected). */
export function authHeader(token: string): string {
  return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

/**
 * Git env that sends the auth header only to the remote's own origin. Passed via
 * GIT_CONFIG_* env vars so the token is never in argv, a URL or .git/config.
 */
export function gitAuthEnv(url: string, token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (!token || !/^https:\/\//.test(url)) return env;
  const origin = new URL(url).origin;
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = `http.${origin}/.extraHeader`;
  env.GIT_CONFIG_VALUE_0 = authHeader(token);
  return env;
}

function scrub(text: string, token?: string): string {
  if (!token) return text;
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  return text.split(b64).join("***").split(token).join("***");
}

function statusOf(stderr: string): number | undefined {
  const m = /error: (\d{3})\b/.exec(stderr);
  if (m) return Number(m[1]);
  if (/Authentication failed|Invalid username or password/i.test(stderr)) return 401;
  if (/Repository not found/i.test(stderr)) return 404;
  return undefined;
}

async function git(
  args: string[],
  opts: { cwd?: string; url: string; slug: string; token?: string },
): Promise<void> {
  try {
    await execFileAsync("git", args, { cwd: opts.cwd, env: gitAuthEnv(opts.url, opts.token) });
  } catch (err) {
    const stderr = scrub((err as { stderr?: string }).stderr?.trim() ?? "", opts.token);
    const status = statusOf(stderr);
    if (status) throw new Error(`clone failed (${status}) for ${opts.slug}`);
    throw new Error(`git ${args[0]} failed for ${opts.slug}${stderr ? `: ${stderr}` : ""}`);
  }
}

/** Fetch exactly the PR head commit; fails cleanly when it no longer exists (force-push). */
async function cloneCode(
  url: string,
  slug: string,
  headSha: string,
  dest: string,
  token?: string,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const o = { url, slug, token };
  await git(["init", "-q"], { ...o, cwd: dest });
  await git(["remote", "add", "origin", url], { ...o, cwd: dest });
  await git(["fetch", "-q", "--depth", "1", "origin", headSha], { ...o, cwd: dest });
  await git(["checkout", "-q", "FETCH_HEAD"], { ...o, cwd: dest });
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
      `${job.owner}/${job.repo}`,
      job.headSha,
      ws.codeDir,
      deps.githubToken,
    );
    const vaultUrl = (deps.vaultUrl ?? defaultUrl)(deps.vaultRepo);
    await git(["clone", "-q", "--depth", "1", vaultUrl, ws.vaultDir], {
      url: vaultUrl,
      slug: deps.vaultRepo,
      token: deps.githubToken,
    });
  } catch (err) {
    await destroyWorkspace(ws).catch(() => {});
    throw err;
  }
  return ws;
}

export async function destroyWorkspace(ws: Workspace): Promise<void> {
  await rm(ws.dir, { recursive: true, force: true });
}
