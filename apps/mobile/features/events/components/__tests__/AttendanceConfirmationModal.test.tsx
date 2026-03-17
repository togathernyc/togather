import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { AttendanceConfirmationModal } from "../AttendanceConfirmationModal";

const mockUseQuery = jest.fn();
const mockConfirmWithToken = jest.fn();
const mockSelfReport = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: jest.fn(() => mockConfirmWithToken),
  useAuthenticatedMutation: jest.fn(() => mockSelfReport),
  api: {
    functions: {
      meetings: {
        attendance: {
          validateAttendanceToken: "api.functions.meetings.attendance.validateAttendanceToken",
          selfReportAttendance: "api.functions.meetings.attendance.selfReportAttendance",
          confirmAttendanceWithToken: "api.functions.meetings.attendance.confirmAttendanceWithToken",
        },
      },
    },
  },
  Id: {},
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
    secondaryColor: "#F5F5F5",
  }),
}));

jest.mock("@components/ui/Modal", () => ({
  CustomModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));

const validTokenData = {
  valid: true,
  alreadyConfirmed: false,
  existingStatus: null,
  meeting: {
    id: "meeting-1",
    title: "Weekly Meetup",
    scheduledAt: "2026-04-01T17:00:00.000Z",
    groupName: "Demo Group",
  },
};

const usedTokenData = {
  valid: false,
  error: "This link has already been used",
};

const expiredTokenData = {
  valid: false,
  error: "This link has expired",
};

const alreadyConfirmedTokenData = {
  valid: true,
  alreadyConfirmed: true,
  existingStatus: 1,
  meeting: {
    id: "meeting-1",
    title: "Weekly Meetup",
    scheduledAt: "2026-04-01T17:00:00.000Z",
    groupName: "Demo Group",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseQuery.mockReturnValue(undefined);
  mockConfirmWithToken.mockResolvedValue("attendance-1");
  mockSelfReport.mockResolvedValue("attendance-1");
});

function renderModal(props: Partial<React.ComponentProps<typeof AttendanceConfirmationModal>> = {}) {
  return render(
    <AttendanceConfirmationModal
      visible={true}
      onClose={jest.fn()}
      meetingId="meeting-1"
      token="test-token"
      eventTitle="Weekly Meetup"
      eventDate="2026-04-01T17:00:00.000Z"
      groupName="Demo Group"
      {...props}
    />
  );
}

describe("AttendanceConfirmationModal", () => {
  it("shows loading state while validating token", () => {
    mockUseQuery.mockReturnValue(undefined);
    renderModal();
    expect(screen.getByText("Validating...")).toBeTruthy();
  });

  it("shows confirm step when token is valid", () => {
    mockUseQuery.mockReturnValue(validTokenData);
    renderModal();
    expect(screen.getByText("Did you attend?")).toBeTruthy();
    expect(screen.getByText("I Attended")).toBeTruthy();
    expect(screen.getByText("I Didn't Attend")).toBeTruthy();
  });

  it("shows error when token is expired", () => {
    mockUseQuery.mockReturnValue(expiredTokenData);
    renderModal();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("This link has expired")).toBeTruthy();
  });

  it("shows error when token is already used on initial load", () => {
    mockUseQuery.mockReturnValue(usedTokenData);
    renderModal();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("This link has already been used")).toBeTruthy();
  });

  it("shows already confirmed step when attendance was previously recorded", () => {
    mockUseQuery.mockReturnValue(alreadyConfirmedTokenData);
    renderModal();
    expect(screen.getByText("Already Confirmed")).toBeTruthy();
  });

  it("shows success after confirming attendance and does NOT revert to error when token reactivity fires", async () => {
    // Auto-confirm the Alert dialog
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const confirmBtn = buttons?.find((b) => b.text === "Confirm");
      confirmBtn?.onPress?.();
    });

    // Start with a valid token
    mockUseQuery.mockReturnValue(validTokenData);
    const { rerender } = renderModal();

    expect(screen.getByText("Did you attend?")).toBeTruthy();

    // Click "I Attended"
    await act(async () => {
      fireEvent.press(screen.getByText("I Attended"));
    });

    // Wait for success step
    await waitFor(() => {
      expect(screen.getByText("Thanks for confirming!")).toBeTruthy();
    });

    // Now simulate Convex reactive re-query returning "already used" after
    // the token was marked as used by the mutation. This is the bug scenario:
    // the useEffect should NOT overwrite the success step.
    mockUseQuery.mockReturnValue(usedTokenData);

    await act(async () => {
      rerender(
        <AttendanceConfirmationModal
          visible={true}
          onClose={jest.fn()}
          meetingId="meeting-1"
          token="test-token"
          eventTitle="Weekly Meetup"
          eventDate="2026-04-01T17:00:00.000Z"
          groupName="Demo Group"
        />
      );
    });

    // The success message should STILL be visible, not the error
    expect(screen.getByText("Thanks for confirming!")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByText("This link has already been used")).toBeNull();
  });

  it("shows success for 'did not attend' and stays on success when token re-validates", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const confirmBtn = buttons?.find((b) => b.text === "Confirm");
      confirmBtn?.onPress?.();
    });

    mockUseQuery.mockReturnValue(validTokenData);
    const { rerender } = renderModal();

    await act(async () => {
      fireEvent.press(screen.getByText("I Didn't Attend"));
    });

    await waitFor(() => {
      expect(screen.getByText("Thanks for confirming!")).toBeTruthy();
    });

    // Simulate reactive re-query
    mockUseQuery.mockReturnValue(usedTokenData);
    await act(async () => {
      rerender(
        <AttendanceConfirmationModal
          visible={true}
          onClose={jest.fn()}
          meetingId="meeting-1"
          token="test-token"
          eventTitle="Weekly Meetup"
          eventDate="2026-04-01T17:00:00.000Z"
          groupName="Demo Group"
        />
      );
    });

    expect(screen.getByText("Thanks for confirming!")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("shows error when mutation fails", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const confirmBtn = buttons?.find((b) => b.text === "Confirm");
      confirmBtn?.onPress?.();
    });

    mockUseQuery.mockReturnValue(validTokenData);
    mockConfirmWithToken.mockRejectedValue(new Error("Network error"));
    renderModal();

    await act(async () => {
      fireEvent.press(screen.getByText("I Attended"));
    });

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(screen.getByText("Network error")).toBeTruthy();
    });
  });

  it("does not render content when modal is not visible", () => {
    mockUseQuery.mockReturnValue(validTokenData);
    renderModal({ visible: false });
    expect(screen.queryByText("Did you attend?")).toBeNull();
  });
});
