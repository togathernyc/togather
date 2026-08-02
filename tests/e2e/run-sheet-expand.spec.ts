import { expect, test } from "@playwright/test";

/**
 * Run sheet rows expand on web (the chevron "dropdown" arrows).
 *
 * The bug: expanded descriptions/notes render through `SelectableText`, which
 * used a multiline `TextInput`. react-native-web turns that into a `<textarea>`
 * and ignores `scrollEnabled={false}`, so it stayed at its default two-row
 * height and clipped everything below — tapping the chevron flipped the arrow
 * but revealed no more text than the two-line collapsed preview, i.e. "the
 * dropdown arrows don't expand".
 *
 * Driven against `/ui-test/run-sheet-expand`, which renders the real
 * `RunSheetItemList` over fixtures (no Convex backend needed). The fixture's
 * `before-5` row carries an eight-line note.
 */
test.describe("Run sheet expandable rows (web)", () => {
  test("expanding a row reveals the whole note, not a clipped textarea", async ({
    page,
  }) => {
    await page.goto("/ui-test/run-sheet-expand");
    await page
      .getByTestId("run-sheet-expand-harness")
      .waitFor({ state: "visible", timeout: 30000 });

    const row = page.getByTestId("run-sheet-row-before-5");
    const collapsedHeight = await row.evaluate((el) => el.clientHeight);

    await row.getByRole("button", { name: /Long note/ }).click();

    // A `<textarea>` here IS the regression — it clips to two rows on web.
    await expect(row.locator("textarea")).toHaveCount(0);

    // The tail of the note is rendered as real text…
    const note = row.getByText(/Line 8:/).first();
    await expect(note).toBeVisible();
    // …and nothing is clipped away inside it.
    const clipped = await note.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    expect(clipped).toBe(false);

    // The whole note is part of the row's rendered text. A `<textarea>` holds
    // its content in `value`, not in the DOM text, so this fails pre-fix.
    await expect(row).toContainText(
      "Line 8: the run sheet note keeps going well past two lines.",
    );

    // And the row genuinely grew rather than swapping one clipped box for
    // another (kept relative — how many lines the note wraps to is viewport
    // dependent).
    const expandedHeight = await row.evaluate((el) => el.clientHeight);
    expect(expandedHeight).toBeGreaterThan(collapsedHeight);

    // And it collapses again. Re-measured rather than pinned to the exact
    // pixel height captured above: the row's height is
    // `max(title line box, chevron line box)`, and the Ionicons web font lands
    // asynchronously, so a measurement taken before it resolves can be ~1px off
    // the settled value.
    await row.getByRole("button", { name: /Long note/ }).click();
    await expect
      .poll(() => row.evaluate((el) => el.clientHeight))
      .toBeLessThan(expandedHeight);
  });
});
