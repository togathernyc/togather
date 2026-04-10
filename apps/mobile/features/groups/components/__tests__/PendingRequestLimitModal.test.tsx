import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { PendingRequestLimitModal } from "../PendingRequestLimitModal";

// Theme hook returns enough colors for the component to render.
jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textInverse: "#fff",
      surface: "#fff",
      surfaceSecondary: "#eee",
      border: "#ccc",
      icon: "#333",
      overlay: "rgba(0,0,0,0.5)",
      modalCloseBackground: "#eee",
      link: "#0066ff",
    },
  }),
}));

describe("PendingRequestLimitModal", () => {
  it("does not render its content when not visible", () => {
    render(
      <PendingRequestLimitModal
        visible={false}
        onDismiss={jest.fn()}
        onViewRequests={jest.fn()}
      />
    );

    expect(screen.queryByText(/already have 2 pending join requests/i)).toBeNull();
  });

  it("renders the title, body copy and both buttons when visible", () => {
    render(
      <PendingRequestLimitModal
        visible={true}
        onDismiss={jest.fn()}
        onViewRequests={jest.fn()}
      />
    );

    expect(screen.getByText("You have pending requests")).toBeTruthy();
    expect(
      screen.getByText(/already have 2 pending join requests/i)
    ).toBeTruthy();
    expect(screen.getByText("View my requests")).toBeTruthy();
    expect(screen.getByText("Dismiss")).toBeTruthy();
  });

  it("calls onDismiss when the Dismiss button is pressed", () => {
    const onDismiss = jest.fn();
    const onViewRequests = jest.fn();

    render(
      <PendingRequestLimitModal
        visible={true}
        onDismiss={onDismiss}
        onViewRequests={onViewRequests}
      />
    );

    fireEvent.press(screen.getByText("Dismiss"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onViewRequests).not.toHaveBeenCalled();
  });

  it("calls onViewRequests when the primary button is pressed", () => {
    const onDismiss = jest.fn();
    const onViewRequests = jest.fn();

    render(
      <PendingRequestLimitModal
        visible={true}
        onDismiss={onDismiss}
        onViewRequests={onViewRequests}
      />
    );

    fireEvent.press(screen.getByText("View my requests"));

    expect(onViewRequests).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
