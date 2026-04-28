import { test, expect } from "@lantern/playwright/fixture";

test("homepage renders the running banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toContainText("Lantern SampleApi is running.");
});

test("two sequential tests get distinct test_ids", async ({ request }) => {
  const res = await request.get("/lantern-scope");
  const body = await res.json();
  expect(body.test_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
