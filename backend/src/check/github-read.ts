const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = `${GITHUB_API}/graphql`;

/** REST GET. Returns undefined on 404; parses JSON unless accept asks for raw text. */
export async function githubRest(
  token: string,
  path: string,
  accept = "application/vnd.github+json",
): Promise<unknown | undefined> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "drift-guard",
    },
  });
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`GitHub REST ${path} -> ${res.status}: ${await res.text()}`);
  }
  return accept.includes("diff") || accept.includes("patch")
    ? res.text()
    : res.json();
}

/** All pages of a list endpoint. */
export async function githubRestAll<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const items = (await githubRest(token, `${path}${sep}per_page=100&page=${page}`)) as T[] | undefined;
    if (!items?.length) return out;
    out.push(...items);
    if (items.length < 100) return out;
  }
}

export async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "drift-guard",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data as T;
}
