// Live smoke check for #12: writes github context files for a real issue + PR.
// Usage: GITHUB_TOKEN=... npx tsx backend/scripts/write-context.ts <owner> <repo> <issue> <pr> <outdir>
import { mkdir } from "node:fs/promises";
import { writeGithubContext } from "../src/check/github-context.js";

const [owner, repo, issue, pr, outdir] = process.argv.slice(2);
if (!owner || !repo || !issue || !pr || !outdir) {
  console.error("usage: write-context.ts <owner> <repo> <issue> <pr> <outdir>");
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN required");
  process.exit(1);
}

await mkdir(outdir, { recursive: true });
await writeGithubContext(
  token,
  outdir,
  { owner, repo, prNumber: Number(pr), headSha: "", issueNumber: Number(issue) },
);
console.log(`wrote context files to ${outdir}`);
