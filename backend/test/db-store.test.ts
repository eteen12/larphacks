import { describe, expect, it } from "vitest";
import { createDbFindingsStore, FindingsStoreError } from "../src/actions/findings-store";
import { fixtureFindings } from "../src/actions/fixtures";
import { seededPool } from "./helpers";

async function store() {
  const { pool, ready } = seededPool(fixtureFindings);
  await ready;
  return createDbFindingsStore(pool);
}

describe("#51 DB findings store", () => {
  it("get returns the finding in the shared shape, null for unknown or non-uuid ids", async () => {
    const s = await store();
    expect(await s.get(fixtureFindings[0]!.id)).toMatchObject({ id: fixtureFindings[0]!.id, repo: "demo-org/demo-shop", pr: 40, issue: 12, state: "open", searches: fixtureFindings[0]!.searches });
    expect(await s.get("d15c0000-0000-4000-8000-0000000000ff")).toBeNull();
    for (const id of ["", ".", "..", "nope", "1' OR '1'='1"]) expect(await s.get(id)).toBeNull();
  });

  it("keeps null note fields as null", async () => {
    const s = await store();
    const noSource = fixtureFindings.find((f) => f.note_quote === null);
    if (noSource) expect(await s.get(noSource.id)).toMatchObject({ note_quote: null, note_path: null, note_date: null });
  });

  it("setState updates the row; unknown id is a 404 FindingsStoreError", async () => {
    const s = await store();
    await s.setState(fixtureFindings[0]!.id, "approved");
    expect((await s.get(fixtureFindings[0]!.id))!.state).toBe("approved");
    const err = await s.setState("nope", "dismissed").catch((e) => e);
    expect(err).toBeInstanceOf(FindingsStoreError);
    expect(err.status).toBe(404);
  });

  it("listByIssue filters by repo and issue", async () => {
    const s = await store();
    expect((await s.listByIssue("demo-org/demo-shop", 12)).map((f) => f.id)).toEqual(fixtureFindings.filter((f) => f.issue === 12).map((f) => f.id));
    expect(await s.listByIssue("demo-org/demo-shop", 999)).toEqual([]);
    expect(await s.listByIssue("other/repo", 12)).toEqual([]);
  });
});
