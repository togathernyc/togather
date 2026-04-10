import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { MyRequestsSection } from "../MyRequestsSection";

const mockUseMyPendingJoinRequests = jest.fn();
const mockCancelJoinRequest = jest.fn();

jest.mock("@features/groups/hooks/useMyPendingJoinRequests", () => ({
  useMyPendingJoinRequests: () => mockUseMyPendingJoinRequests(),
  PENDING_JOIN_REQUEST_LIMIT: 2,
}));

jest.mock("@features/groups/hooks/useGroups", () => ({
  useCancelJoinRequest: () => mockCancelJoinRequest,
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textTertiary: "#666",
      border: "#ccc",
      icon: "#333",
      surface: "#fff",
      surfaceSecondary: "#eee",
      textInverse: "#fff",
      link: "#0066ff",
      destructive: "#cc0000",
      overlay: "rgba(0,0,0,0.5)",
      modalCloseBackground: "#eee",
    },
  }),
}));

jest.mock("@components/ui", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    Card: ({ children, style }: any) =>
      ReactActual.createElement(RN.View, { style }, children),
  };
});

jest.mock("@/utils/error-handling", () => ({
  formatError: (_err: unknown, fallback: string) => fallback,
}));

describe("MyRequestsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelJoinRequest.mockResolvedValue({ success: true });
  });

  it("renders nothing when there are no pending requests", () => {
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [],
      count: 0,
      isAtLimit: false,
      isLoading: false,
    });

    const { toJSON } = render(<MyRequestsSection />);
    expect(toJSON()).toBeNull();
  });

  it("renders pending requests with group name and group type", () => {
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [
        {
          id: "req-1",
          groupId: "g-1",
          groupName: "Smith Family Dinner",
          groupTypeName: "Dinner Parties",
          requestedAt: 1000,
        },
        {
          id: "req-2",
          groupId: "g-2",
          groupName: "Worship Team",
          groupTypeName: "Teams",
          requestedAt: 2000,
        },
      ],
      count: 2,
      isAtLimit: true,
      isLoading: false,
    });

    render(<MyRequestsSection />);

    expect(screen.getByText("My Requests")).toBeTruthy();
    expect(screen.getByText("Smith Family Dinner")).toBeTruthy();
    expect(screen.getByText("Dinner Parties")).toBeTruthy();
    expect(screen.getByText("Worship Team")).toBeTruthy();
    expect(screen.getByText("Teams")).toBeTruthy();
  });

  it("opens the confirm modal when withdraw is pressed", () => {
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [
        {
          id: "req-1",
          groupId: "g-1",
          groupName: "Smith Family Dinner",
          groupTypeName: "Dinner Parties",
          requestedAt: 1000,
        },
      ],
      count: 1,
      isAtLimit: false,
      isLoading: false,
    });

    render(<MyRequestsSection />);

    expect(
      screen.queryByText("Withdraw your request to join Smith Family Dinner?")
    ).toBeNull();

    fireEvent.press(
      screen.getByLabelText("Withdraw request to join Smith Family Dinner")
    );

    expect(
      screen.getByText("Withdraw your request to join Smith Family Dinner?")
    ).toBeTruthy();
  });

  it("calls cancelJoinRequest when the confirm modal's Withdraw is pressed", async () => {
    mockCancelJoinRequest.mockResolvedValue({ success: true });
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [
        {
          id: "req-1",
          groupId: "g-1",
          groupName: "Smith Family Dinner",
          groupTypeName: "Dinner Parties",
          requestedAt: 1000,
        },
      ],
      count: 1,
      isAtLimit: false,
      isLoading: false,
    });

    render(<MyRequestsSection />);

    fireEvent.press(
      screen.getByLabelText("Withdraw request to join Smith Family Dinner")
    );

    // The Withdraw button inside the ConfirmModal — distinguish from the row's
    // Withdraw button (which has an accessibility label).
    const confirmButtons = screen.getAllByText("Withdraw");
    const modalConfirm = confirmButtons[confirmButtons.length - 1];
    fireEvent.press(modalConfirm);

    await waitFor(() => {
      expect(mockCancelJoinRequest).toHaveBeenCalledWith({ groupId: "g-1" });
    });
  });

  it("does not call cancelJoinRequest when the confirm modal's Cancel is pressed", () => {
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [
        {
          id: "req-1",
          groupId: "g-1",
          groupName: "Smith Family Dinner",
          groupTypeName: "Dinner Parties",
          requestedAt: 1000,
        },
      ],
      count: 1,
      isAtLimit: false,
      isLoading: false,
    });

    render(<MyRequestsSection />);

    fireEvent.press(
      screen.getByLabelText("Withdraw request to join Smith Family Dinner")
    );

    fireEvent.press(screen.getByText("Cancel"));

    expect(mockCancelJoinRequest).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Withdraw your request to join Smith Family Dinner?")
    ).toBeNull();
  });
});
