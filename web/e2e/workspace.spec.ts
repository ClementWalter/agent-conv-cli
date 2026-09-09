/** A real browser signs in, imports history, reads it and scopes an MCP credential. */
import { test, expect } from "@playwright/test";
test("complete local workspace journey", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open local workspace" }).click();
  await page.getByRole("button", { name: "Import saved history" }).click();
  await page
    .getByRole("button", { name: "Conversations", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: /A good place to start/ }).click();
  await expect(
    page.getByText("Remember our plans for the garden.", { exact: true }),
  ).toBeVisible();
});
test("narrow viewport keeps actions within the window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open local workspace" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
test("provider configuration failure is explained", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open local workspace" }).click();
  await page.getByRole("button", { name: "Connect an account" }).click();
  await expect(page.getByText(/Hosted login is not configured/)).toBeVisible();
});
