import React from "react";
import { render } from "@testing-library/react-native";
import {
  RsvpEditModal,
  isGoingRsvpOption,
  GOING_RSVP_OPTION_ID,
} from "../EventRsvpSection";

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      surface: "#fff",
      border: "#eee",
      iconSecondary: "#999",
    },
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
    secondaryColor: "#F5F5F5",
  }),
}));

// Regression: plus-ones must key off the stable option id slot (1 = Going),
// not the label text — hosts rename labels freely ("I'm there 😳") and the
// old label heuristic hid the guest stepper on custom-labeled events.
const CUSTOM_LABEL_OPTIONS = [
  { id: 1, label: "I'm there 😳", enabled: true },
  { id: 2, label: "Still deciding 🫣", enabled: true },
  { id: 3, label: "No can do ☹️", enabled: true },
];

describe("isGoingRsvpOption", () => {
  test("matches the Going slot regardless of label", () => {
    expect(isGoingRsvpOption({ id: GOING_RSVP_OPTION_ID })).toBe(true);
    expect(isGoingRsvpOption(CUSTOM_LABEL_OPTIONS[0])).toBe(true);
    expect(isGoingRsvpOption(CUSTOM_LABEL_OPTIONS[1])).toBe(false);
    expect(isGoingRsvpOption(CUSTOM_LABEL_OPTIONS[2])).toBe(false);
    expect(isGoingRsvpOption(null)).toBe(false);
    expect(isGoingRsvpOption(undefined)).toBe(false);
  });
});

describe("RsvpEditModal guest stepper", () => {
  const baseProps = {
    visible: true,
    onClose: jest.fn(),
    options: CUSTOM_LABEL_OPTIONS,
    loadingOptionId: null,
    onSelect: jest.fn(),
  };

  test("shows the stepper when the Going slot is selected, even with a custom label", () => {
    const { getByTestId } = render(
      <RsvpEditModal {...baseProps} currentOptionId={1} />
    );
    expect(getByTestId("guest-stepper-increment")).toBeTruthy();
  });

  test("hides the stepper for non-Going slots", () => {
    const { queryByTestId } = render(
      <RsvpEditModal {...baseProps} currentOptionId={3} />
    );
    expect(queryByTestId("guest-stepper-increment")).toBeNull();
  });
});
