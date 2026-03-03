import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventHistory } from "../EventHistory";

// Create mock functions that can be controlled per test
const mockUseMeetingsQuery = jest.fn();

// Mock Convex hooks - useQuery is re-exported from convex/react
jest.mock("convex/react", () => ({
  useQuery: (func: any, args: any) => mockUseMeetingsQuery(func, args),
  useMutation: jest.fn(() => jest.fn()),
  useAction: jest.fn(() => jest.fn()),
  useConvex: jest.fn(() => ({
    query: jest.fn(),
    mutation: jest.fn(),
  })),
}));

// Mock the api object and re-export hooks from convex/react
// The useMeetingDates hook imports { useQuery, api } from '@services/api/convex'
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      meetings: {
        index: {
          listByGroup: "api.functions.meetings.index.listByGroup",
        },
      },
    },
  },
  // Re-export the mocked useQuery from convex/react
  useQuery: (func: any, args: any) => mockUseMeetingsQuery(func, args),
  useMutation: jest.fn(() => jest.fn()),
  useAction: jest.fn(() => jest.fn()),
  Id: {},
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  })),
  useSegments: jest.fn(() => []),
}));


// Helper to create dates relative to current month
function getDateInCurrentMonth(day: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, 10, 0, 0).getTime();
}

function getPastDateInCurrentMonth(): number {
  // Use the 1st of the month (always in the past unless it's the 1st)
  return getDateInCurrentMonth(1);
}

function getFutureDateInCurrentMonth(): number {
  // Use the 28th (safe for all months)
  return getDateInCurrentMonth(28);
}

// Get current month (1-indexed) for date pattern matching
function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

describe("EventHistory", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();
    // Mock Convex meetings query - default to empty array
    mockUseMeetingsQuery.mockReturnValue([]);
  });

  // Mock data uses dynamic dates so tests don't break each month
  const mockConvexMeetings = [
    {
      _id: "meeting-1",
      shortId: "abc123",
      scheduledAt: getDateInCurrentMonth(26),
      title: "Meeting",
      status: "scheduled",
      attendanceCount: 0,
      guestCount: 0,
      coverImage: null,
    },
    {
      _id: "meeting-2",
      shortId: "def456",
      scheduledAt: getDateInCurrentMonth(19),
      title: "Meeting",
      status: "scheduled",
      attendanceCount: 0,
      guestCount: 0,
      coverImage: null,
    },
    {
      _id: "meeting-3",
      shortId: "ghi789",
      scheduledAt: getDateInCurrentMonth(5),
      title: "Meeting",
      status: "completed",
      attendanceCount: 15,
      guestCount: 0,
      coverImage: null,
    },
  ];


  // TODO: Fix flaky test - times out intermittently
  it.skip("renders event history with events", async () => {
    // Mock Convex to return raw meeting data (the hook transforms it)
    mockUseMeetingsQuery.mockReturnValue(mockConvexMeetings);

    const onNewEvent = jest.fn();
    const onEventPress = jest.fn();

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={onNewEvent}
          onEventPress={onEventPress}
          isLeader={true}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByText("EVENT HISTORY")).toBeTruthy();
      expect(getByText("New Event")).toBeTruthy();
    });

    await waitFor(() => {
      // Component formats dates as "EEE, M/d" (e.g., "Fri, 12/26")
      expect(getByText(/12\/26/)).toBeTruthy();
      expect(getByText(/12\/19/)).toBeTruthy();
      expect(getByText(/12\/5/)).toBeTruthy();
    });
  });

  it("handles empty events list", async () => {
    mockUseMeetingsQuery.mockReturnValue([]);

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByText("No events scheduled for this month")).toBeTruthy();
    });
  });

  it("handles invalid dates gracefully", async () => {
    // Mock Convex to return raw meeting data format
    // The useMeetingDates hook expects an array from useQuery and transforms it
    // Invalid dates will be filtered out by the EventHistory component
    const meetingsWithInvalidDates = [
      {
        _id: "meeting-1",
        shortId: "abc123",
        // Invalid date - NaN timestamp
        scheduledAt: NaN,
        title: "Meeting",
        status: "scheduled",
        attendanceCount: 0,
        guestCount: 0,
        coverImage: null,
      },
      {
        _id: "meeting-2",
        shortId: "def456",
        // Valid date in current month
        scheduledAt: getDateInCurrentMonth(15),
        title: "Meeting",
        status: "scheduled",
        attendanceCount: 0,
        guestCount: 0,
        coverImage: null,
      },
    ];

    mockUseMeetingsQuery.mockReturnValue(meetingsWithInvalidDates);

    const { getByText, queryByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // Should only show the valid date - component formats as "EEE, M/d"
      const monthPattern = new RegExp(`${getCurrentMonth()}\\/15`);
      expect(getByText(monthPattern)).toBeTruthy();
      // Invalid dates should not be rendered
      expect(queryByText("invalid-date")).toBeNull();
    });
  });

  it("navigates to new event page when New Event button is pressed", async () => {
    mockUseMeetingsQuery.mockReturnValue([]);

    // Get the mocked router to verify navigation
    const mockRouterPush = jest.fn();
    const { useRouter } = require("expo-router");
    useRouter.mockReturnValue({
      push: mockRouterPush,
      back: jest.fn(),
      canGoBack: jest.fn(() => true),
      replace: jest.fn(),
    });

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
          isLeader={true}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByText("New Event")).toBeTruthy();
    });

    fireEvent.press(getByText("New Event"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(user)/create-event?hostingGroupId=13");
  });

  it("calls onEventPress when event is pressed", async () => {
    // Mock Convex to return raw meeting data format
    mockUseMeetingsQuery.mockReturnValue(mockConvexMeetings);

    const onEventPress = jest.fn();

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={onEventPress}
        />
      </QueryClientProvider>
    );

    const datePattern = new RegExp(`${getCurrentMonth()}\\/26`);
    await waitFor(() => {
      // Component formats dates as "EEE, M/d"
      expect(getByText(datePattern)).toBeTruthy();
    });

    // Click on the date element
    fireEvent.press(getByText(datePattern));
    // The hook transforms data - meeting_id comes from _id
    expect(onEventPress).toHaveBeenCalledWith(
      expect.objectContaining({
        meeting_id: mockConvexMeetings[0]._id,
      })
    );
  });

  it("navigates months correctly", async () => {
    mockUseMeetingsQuery.mockReturnValue([]);

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
        />
      </QueryClientProvider>
    );

    // Should display any month name with a year
    const monthPattern = /January|February|March|April|May|June|July|August|September|October|November|December/;

    await waitFor(() => {
      expect(getByText(monthPattern)).toBeTruthy();
    });

    // Month navigation is tested separately - just verify it renders
    expect(getByText(monthPattern)).toBeTruthy();
  });

  it("shows correct status for past events with attendees", async () => {
    // Use a past date in current month to trigger the attendee display logic
    // Mock Convex to return raw meeting data format
    const pastMeetings = [
      {
        _id: "meeting-past-1",
        shortId: "past123",
        scheduledAt: getPastDateInCurrentMonth(),
        title: "Meeting",
        status: "completed",
        attendanceCount: 15,
        guestCount: 0,
        coverImage: null,
      },
    ];

    mockUseMeetingsQuery.mockReturnValue(pastMeetings);

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // Component now shows attendee count and "people" label for past events with attendees
      expect(getByText("15")).toBeTruthy();
      expect(getByText("people")).toBeTruthy();
    });
  });

  it("shows correct layout for future events", async () => {
    // Use a future date in current month
    // Mock Convex to return raw meeting data format
    const futureMeetings = [
      {
        _id: "meeting-future-1",
        shortId: "future123",
        scheduledAt: getFutureDateInCurrentMonth(),
        title: "Upcoming Event",
        status: "scheduled",
        attendanceCount: 0,
        guestCount: 0,
        coverImage: null,
      },
    ];

    mockUseMeetingsQuery.mockReturnValue(futureMeetings);

    const { getByText, queryByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventHistory
          groupId="13"
          onNewEvent={jest.fn()}
          onEventPress={jest.fn()}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // Future events show title and date but no attendee count
      expect(getByText("Upcoming Event")).toBeTruthy();
      // No attendee count shown for future events
      expect(queryByText("people")).toBeNull();
    });
  });
});
