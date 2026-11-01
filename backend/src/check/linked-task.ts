import { githubGraphql } from "./github-read.js";

export interface PrLinkInput {
  /** Issue numbers GitHub lists as linked/closing for this PR, in GitHub's order. */
  closingIssueNumbers?: number[];
  body?: string | null;
  headRefName: string;
}

const KEYWORD_RE = /\b(?:closes|fixes|resolves)\s+#(\d+)/i;
const BRANCH_RE = /^(\d+)(?:[-_].*)?$/;

/**
 * Resolve the task issue a pull request is linked to, or null ("not linked").
 * Order: GitHub's linked closing issues -> Closes/Fixes/Resolves #N in the
 * body -> a leading number on the branch name.
 */
export function extractLinkedTask(pr: PrLinkInput): number | null {
  const closing = pr.closingIssueNumbers?.[0];
  if (closing) return closing;

  const keyword = pr.body ? KEYWORD_RE.exec(pr.body) : null;
  if (keyword) return Number(keyword[1]);

  const branch = BRANCH_RE.exec(pr.headRefName);
  if (branch) return Number(branch[1]);

  return null;
}

interface ClosingIssuesData {
  repository: {
    pullRequest: {
      closingIssuesReferences: { nodes: { number: number }[] };
    } | null;
  };
}

const CLOSING_ISSUES_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      closingIssuesReferences(first: 5) { nodes { number } }
    }
  }
}`;

/** GitHub's linked closing issues for a PR. Fails open ([]) so keyword/branch still apply. */
export async function fetchClosingIssueNumbers(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number[]> {
  try {
    const data = await githubGraphql<ClosingIssuesData>(token, CLOSING_ISSUES_QUERY, {
      owner,
      repo,
      pr: prNumber,
    });
    return (
      data.repository.pullRequest?.closingIssuesReferences.nodes.map((n) => n.number) ?? []
    );
  } catch (err) {
    console.warn("closing-issues lookup failed; falling back to body/branch", err);
    return [];
  }
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  body?: string | null;
  headRefName: string;
}

/** Full #8 lookup for a real pull request. */
export async function findLinkedTask(token: string, pr: PrRef): Promise<number | null> {
  const closingIssueNumbers = await fetchClosingIssueNumbers(
    token,
    pr.owner,
    pr.repo,
    pr.number,
  );
  return extractLinkedTask({
    closingIssueNumbers,
    body: pr.body,
    headRefName: pr.headRefName,
  });
}
