import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AssignmentDetailScreen } from "../AssignmentDetailScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    push: mockPush,
    replace: jest.fn(),
  }),
  useLocalSearchParams: () => ({ id: "assignment-1" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      border: "#e5e5e5",
      success: "#16a34a",
      destructive: "#dc2626",
      primary: "#2563EB",
    },
    isDark: false,
  }),
}));

jest.mock("../../hooks/useRespondToAssignment", () => ({
  useRespondToAssignment: () => ({
    respond: jest.fn(),
    declineWith: jest.fn(),
    busyId: null,
  }),
}));

jest.mock("../DeclineNoteModal", () => ({
  DeclineNoteModal: () => null,
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        mySchedule: {
          myAssignments: "api.functions.scheduling.mySchedule.myAssignments",
        },
        events: { getEvent: "api.functions.scheduling.events.getEvent" },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

const mockQuery = useAuthenticatedQuery as jest.Mock;

const ASSIGNMENT = {
  _id: "assignment-1",
  planId: "plan-1",
  eventTitle: "Sunday Gathering",
  eventDate: new Date("2026-06-14T10:00:00").getTime(),
  roleName: "Acoustic Guitar",
  teamName: "Worship",
  status: "confirmed",
};

function mockQueries(event: unknown) {
  mockQuery.mockImplementation((ref: string) => {
    if (ref === "api.functions.scheduling.mySchedule.myAssignments") {
      return [ASSIGNMENT];
    }
    if (ref === "api.functions.scheduling.events.getEvent") return event;
    return undefined;
  });
}

describe("AssignmentDetailScreen — rehearse entry point", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a 'Rehearse songs' row when the plan's run sheet has songs", () => {
    mockQueries({
      groupId: "group-1",
      roles: [],
      items: [
        { _id: "item-1", type: "song", title: "Build My Life" },
        { _id: "item-2", type: "item", title: "Announcements" },
      ],
    });

    const { getByText } = render(<AssignmentDetailScreen />);

    fireEvent.press(getByText("Rehearse songs"));
    expect(mockPush).toHaveBeenCalledWith(
      "/rostering/group-1/run-sheet/rehearse/plan-1",
    );
  });

  it("hides the row when the run sheet has no songs", () => {
    mockQueries({
      groupId: "group-1",
      roles: [],
      items: [{ _id: "item-2", type: "item", title: "Announcements" }],
    });

    const { queryByText } = render(<AssignmentDetailScreen />);
    expect(queryByText("Rehearse songs")).toBeNull();
  });

  it("hides the row while the event is still loading", () => {
    mockQueries(undefined);

    const { queryByText } = render(<AssignmentDetailScreen />);
    expect(queryByText("Rehearse songs")).toBeNull();
  });
});
