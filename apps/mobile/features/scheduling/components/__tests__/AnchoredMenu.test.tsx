import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
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
 * Regression guard for the desktop-web bug (issue #728): the backdrop and menu
 * must be SIBLINGS so an option press selects instead of being swallowed by the
 * backdrop's dismiss handler. When the menu was nested inside the backdrop
 * Pressable, react-native-web's `stopPropagation` failed to stop DOM bubbling,
 * so every option click closed the menu instead of selecting.
 */
describe("AnchoredMenu", () => {
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
