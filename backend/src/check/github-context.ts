import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { githubGraphql, githubRest, githubRestAll } from "./github-read.js";
import type { CheckJob } from "./queue.js";

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  user: { login: string } | null;
  created_at: string;
}

interface Comment {
  user: { login: string } | null;
  created_at: string;
  body: string | null;
}

interface Pull extends Issue {
  draft?: boolean;
  head?: { ref: string };
  base?: { ref: string };
}

function commentLines(comments: Comment[]): string {
  if (!comments.length) return "_no comments_\n";
  return comments
    .map((c) => `### @${c.user?.login ?? "unknown"} — ${c.created_at}\n\n${c.body ?? ""}\n`)
    .join("\n");
}

function issueMd(issue: Issue, comments: Comment[]): string {
  const labels = issue.labels.map((l) => l.name).join(", ") || "none";
  return `#${issue.number} ${issue.title}\n\nstate: ${issue.state} · labels: ${labels}\n\n${issue.body ?? ""}\n\n## Comments\n\n${commentLines(comments)}`;
}

/** Board fields for the issue across its Projects v2 items. */
const BOARD_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 10) {
        nodes {
          project { title }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}`;

type FieldNode =
  | { __typename: string; name?: string; text?: string; number?: number; date?: string; title?: string; field?: { name?: string } };

interface BoardData {
  repository: {
    issue: {
      projectItems: {
        nodes: { project: { title: string }; fieldValues: { nodes: FieldNode[] } }[];
      };
    } | null;
  };
}

function fieldValue(n: FieldNode): string | undefined {
  return n.name ?? n.text ?? n.date ?? n.title ?? (n.number !== undefined ? String(n.number) : undefined);
}

async function boardMd(token: string, job: CheckJob): Promise<string> {
  const data = await githubGraphql<BoardData>(token, BOARD_QUERY, {
    owner: job.owner,
    repo: job.repo,
    number: job.issueNumber,
  });
  const items = data.repository.issue?.projectItems.nodes ?? [];
  if (!items.length) return "not on a board\n";
  return items
    .map((item) => {
      const lines = item.fieldValues.nodes
        .map((n) => {
          const field = n.field?.name;
          const value = fieldValue(n);
          return field && value !== undefined ? `- ${field}: ${value}` : null;
        })
        .filter((l): l is string => l !== null);
      return `project: ${item.project.title}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

/** Parent chain via the sub-issue parent link, nearest first, up to the top. */
async function parentsMd(token: string, job: CheckJob): Promise<string> {
  const parts: string[] = [];
  let current = job.issueNumber;
  for (let depth = 0; depth < 10; depth++) {
    const parent = (await githubRest(
      token,
      `/repos/${job.owner}/${job.repo}/issues/${current}/parent`,
    )) as Issue | undefined;
    if (!parent) break;
    const comments = (await githubRestAll<Comment>(
      token,
      `/repos/${job.owner}/${job.repo}/issues/${parent.number}/comments`,
    )) as Comment[];
    parts.push(issueMd(parent, comments));
    current = parent.number;
  }
  return parts.length ? parts.join("\n\n---\n\n") : "no parent\n";
}

/** Write issue.md, parents.md, board.md, pr.md and diff.patch into the run's github/ dir. */
export async function writeGithubContext(
  token: string,
  githubDir: string,
  job: CheckJob,
): Promise<void> {
  const base = `/repos/${job.owner}/${job.repo}`;
  const [issue, issueComments, pr, prComments, board, diff] = await Promise.all([
    githubRest(token, `${base}/issues/${job.issueNumber}`) as Promise<Issue>,
    githubRestAll<Comment>(token, `${base}/issues/${job.issueNumber}/comments`),
    githubRest(token, `${base}/pulls/${job.prNumber}`) as Promise<Pull>,
    githubRestAll<Comment>(token, `${base}/issues/${job.prNumber}/comments`),
    boardMd(token, job),
    githubRest(token, `${base}/pulls/${job.prNumber}`, "application/vnd.github.diff") as Promise<string>,
  ]);

  const prText = `#${pr.number} ${pr.title}${pr.draft ? " [draft]" : ""}\n\nstate: ${pr.state} · ${pr.head?.ref ?? "?"} -> ${pr.base?.ref ?? "?"}\n\n${pr.body ?? ""}\n\n## Comments\n\n${commentLines(prComments)}`;

  await Promise.all([
    writeFile(join(githubDir, "issue.md"), issueMd(issue, issueComments)),
    writeFile(join(githubDir, "parents.md"), await parentsMd(token, job)),
    writeFile(join(githubDir, "board.md"), board),
    writeFile(join(githubDir, "pr.md"), prText),
    writeFile(join(githubDir, "diff.patch"), diff ?? ""),
  ]);
}
