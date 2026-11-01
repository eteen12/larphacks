import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3100";
const ITEM = "Slow-season discount";

type State = {
  findings: { id: string; state: string }[];
  calls: { method: string; target: number | string; state?: string; description?: string }[];
  statuses: { state: string }[];
  issueState: string;
  issueComments: string[];
  prComments: string[];
};

const backend = async (page: Page): Promise<State> => (await page.request.get(`${API}/__e2e/state`)).json();

test.beforeEach(async ({ page }) => {
  expect((await page.request.post(`${API}/__e2e/reset`)).ok()).toBe(true);
  await page.goto("/");
  await expect(card(page)).toBeVisible();
});

// The card, not the decision sheet (a portal outside #root that also names the item).
const card = (page: Page) => page.locator("#root").getByText(ITEM, { exact: true });

async function swipe(page: Page, dx: number) {
  const box = (await card(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 4, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 15 });
  await page.mouse.up();
}

async function sendDrift(page: Page, instruction: string) {
  await page.getByPlaceholder(/Set the refund window/).fill(instruction);
  await page.getByRole("button", { name: "Send" }).click();
}

async function expectApproved(page: Page, instruction: string) {
  await expect(page.getByText("No drift. Nice.")).toBeVisible();
  const s = await backend(page);
  expect(s.findings.map((f) => f.state)).toEqual(["approved"]);
  expect(s.issueState).toBe("open");
  expect(s.calls.map((c) => c.method)).toEqual(["reopenIssue", "commentOnIssue", "commentOnIssue"]);
  expect(s.issueComments.join("\n")).toContain(instruction);
  expect(s.prComments).toHaveLength(1);
  expect(s.prComments[0]).toMatch(new RegExp(`^@claude ${instruction}`));
}

async function expectDismissed(page: Page) {
  await expect(page.getByText("No drift. Nice.")).toBeVisible();
  const s = await backend(page);
  expect(s.findings.map((f) => f.state)).toEqual(["dismissed"]);
  expect(s.statuses.map((x) => x.state)).toEqual(["success"]);
  expect(s.calls.map((c) => c.method)).toEqual(["setCommitStatus"]);
}

test("Drift button: instruction, Send, approved on GitHub, card leaves", async ({ page }) => {
  await page.getByRole("button", { name: "Drift", exact: true }).click();
  await sendDrift(page, "Use 8 percent");
  await expectApproved(page, "Use 8 percent");
});

test("Not drift button: dismissed, success status, card leaves", async ({ page }) => {
  await page.getByRole("button", { name: "Not drift" }).click();
  await expectDismissed(page);
});

test("a failing backend brings the card back with Retry", async ({ page }) => {
  await page.request.post(`${API}/__e2e/fail-next`, { data: { method: "reopenIssue", status: 500 } });
  await page.getByRole("button", { name: "Drift", exact: true }).click();
  await sendDrift(page, "Use 8 percent");

  await expect(page.getByText("The server returned 502.")).toBeVisible();
  await expect(card(page)).toBeVisible();
  expect((await backend(page)).findings.map((f) => f.state)).toEqual(["open"]);

  await page.getByText("Retry", { exact: true }).click();
  await expectApproved(page, "Use 8 percent");
});

// Known: on desktop the mouse drag did not move the card (buttons work). Whether it works at phone
// size in Playwright is checked by these two tests; if they fail, they are marked fixme below.
test("swipe right: instruction, Send, approved, card leaves", async ({ page }) => {
  await swipe(page, 300);
  await sendDrift(page, "Use 8 percent");
  await expectApproved(page, "Use 8 percent");
});

test("swipe left: dismissed, success status, card leaves", async ({ page }) => {
  await swipe(page, -300);
  await expectDismissed(page);
});
