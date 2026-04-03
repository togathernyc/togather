import { expect, test } from "@playwright/test";

test.describe("Issue #49 RSVP refresh regression", () => {
  test("keeps displayed RSVP count after reload", async ({ page }) => {
    await page.goto("/ui-test/event-rsvp-refresh");
    await page.evaluate(() => {
      window.localStorage.removeItem("playwright:rsvp-refresh-mode");
    });
    await page.reload();

    // Wait for the test harness to mount before asserting
    await page.getByTestId("rsvp-refresh-screen").waitFor({ state: "visible", timeout: 15000 });
    await expect(page.getByTestId("mode-value")).toContainText("initial");
    await expect(page.getByTestId("preview-users-value")).toContainText("12");
    await expect(page.getByTestId("displayed-count-value")).toContainText("12");

    await page.evaluate(() => {
      window.localStorage.setItem("playwright:rsvp-refresh-mode", "reloaded");
    });
    await page.reload();

    await page.getByTestId("rsvp-refresh-screen").waitFor({ state: "visible", timeout: 15000 });
    await expect(page.getByTestId("mode-value")).toContainText("reloaded");
    await expect(page.getByTestId("preview-users-value")).toContainText("1");
    await expect(page.getByTestId("displayed-count-value")).toContainText("12");
  });
});
