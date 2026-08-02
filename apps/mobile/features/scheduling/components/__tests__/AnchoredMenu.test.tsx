import React from "react";
import { fireEvent, render, within } from "@testing-library/react-native";
import { AnchoredMenu, type AnchoredMenuOption } from "../AnchoredMenu";

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceSecondary: "#eee",
      border: "#ccc",
      buttonPrimary: "#2563EB",
    },
  }),
}));

const ANCHOR = { x: 40, y: 120, width: 160, height: 32 };
const OPTIONS: AnchoredMenuOption[] = [
  { id: "pre", name: "Pre-service" },
  { id: "service", name: "Service" },
  { id: "post", name: "Post-service" },
];

/**
 * The desktop-web bug (issue #728) was a DOM event-bubbling defect: with the
 * menu nested INSIDE the backdrop Pressable, react-native-web's
 * `stopPropagation` failed to stop a real option click from bubbling up to the
 * backdrop's `onClose`, so every click dismissed the menu instead of selecting.
 * The fix makes the backdrop and menu SIBLINGS.
 *
 * This preset renders through `react-test-renderer` (no DOM, no DOM bubbling)
 * and `fireEvent.press` invokes only the nearest `onPress`, so the behavioral
 * "select / dismiss" tests below CANNOT reproduce the bug — they document the
 * contract but would stay green on the un-fixed nested tree too. The actual
 * regression guard is the STRUCTURAL test ("keeps the backdrop … a sibling"):
 * it asserts the option rows are not descendants of the backdrop, which is the
 * one condition that fails the moment the buggy nesting comes back.
 */
describe("AnchoredMenu", () => {
  it("keeps the backdrop a sibling of the options, not their ancestor (regression guard for #728)", () => {
    const { getByTestId } = render(
      <AnchoredMenu
        anchor={ANCHOR}
        options={OPTIONS}
        selectedId="pre"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // If the menu were nested inside the backdrop (the #728 bug), the option
    // rows would be descendants of the backdrop Pressable and this scoped
    // query would find them. As siblings, the backdrop subtree is empty.
    const backdrop = getByTestId("anchored-menu-backdrop");
    expect(within(backdrop).queryByText("Service")).toBeNull();
    expect(within(backdrop).queryByText("Pre-service")).toBeNull();
    expect(within(backdrop).queryByText("Post-service")).toBeNull();
  });

  it("selects an option (and does not dismiss) when a row is pressed", () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <AnchoredMenu
        anchor={ANCHOR}
        options={OPTIONS}
        selectedId="pre"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    fireEvent.press(getByText("Service"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("service");
    // The press must NOT bubble to the backdrop's dismiss handler.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses when the backdrop is pressed", () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AnchoredMenu
        anchor={ANCHOR}
        options={OPTIONS}
        selectedId="pre"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    fireEvent.press(getByTestId("anchored-menu-backdrop"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports null for the empty option", () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <AnchoredMenu
        anchor={ANCHOR}
        options={OPTIONS}
        selectedId="service"
        emptyOption={{ label: "No segment" }}
        onSelect={onSelect}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(getByText("No segment"));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("toggles rows without dismissing in multi-select mode", () => {
    const onToggle = jest.fn();
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { getByText } = render(
      <AnchoredMenu
        anchor={ANCHOR}
        options={OPTIONS}
        selectedIds={["pre"]}
        onSelect={onSelect}
        onToggle={onToggle}
        onClose={onClose}
      />,
    );

    fireEvent.press(getByText("Service"));

    expect(onToggle).toHaveBeenCalledWith("service");
    expect(onSelect).not.toHaveBeenCalled();
    // Multi-select stays open — only an outside press closes it.
    expect(onClose).not.toHaveBeenCalled();
  });
});
