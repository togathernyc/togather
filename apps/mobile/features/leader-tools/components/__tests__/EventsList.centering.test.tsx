/**
 * The Attendance event picker scrolls the relevant event card to the middle of
 * the strip. `EventsList.scroll.test.ts` covers the arithmetic in isolation;
 * this covers the wiring around it — which card gets chosen, and that the
 * measured viewport actually reaches the scroll call.
 *
 * Expected offsets are written out longhand from the card metrics (132pt card,
 * 12pt gap, 16pt screen margin) rather than by calling the component's own
 * helper, so a drift in either the metrics or the helper fails this test.
 *
 * Fixtures arrive newest-first, matching the backend — `listByGroup` queries
 * `.order("desc")` — so the component's own ascending re-sort is exercised
 * rather than accidentally pre-satisfied.
 */
import React from "react";
import { render, fireEvent, act, screen } from "@testing-library/react-native";
import { ScrollView } from "react-native";

const mockUseQuery = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  api: {
    functions: { meetings: { index: { listByGroup: "listByGroup" } } },
  },
}));

import { EventsList } from "../EventsList";

const CARD_PITCH = 132 + 12;
const MARGIN = 16;
const HALF_CARD = 132 / 2;
const VIEWPORT = 390;

/** Offset that puts card `index` in the middle of a `VIEWPORT`-wide strip. */
const centeredOffset = (index: number) =>
  Math.max(0, MARGIN + index * CARD_PITCH + HALF_CARD - VIEWPORT / 2);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const meeting = (id: string, title: string, offsetDays: number) => ({
  _id: id,
  title,
  scheduledAt: now + offsetDays * DAY,
});

/**
 * Newest-first, as the backend returns them. Sorted ascending by the component,
 * "Last week" lands at index 3 and "Next week" at index 4.
 */
const MEETINGS = [
  meeting("m4", "Next week", 7),
  meeting("m3", "Last week", -7),
  meeting("m2", "Two weeks ago", -14),
  meeting("m1", "Three weeks ago", -21),
  meeting("m0", "Four weeks ago", -28),
];

let scrollToSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  scrollToSpy = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation();
  mockUseQuery.mockReturnValue(MEETINGS);
});

afterEach(() => {
  scrollToSpy.mockRestore();
  jest.useRealTimers();
});

function renderStrip(selectedDate: string | null = null) {
  render(
    <EventsList groupId="group_1" selectedDate={selectedDate} onEventSelect={jest.fn()} />
  );
}

/** Report a viewport width to the strip and let its deferred scroll run. */
function measureViewport() {
  fireEvent(screen.getByTestId("events-list-viewport"), "layout", {
    nativeEvent: { layout: { width: VIEWPORT, height: 160 } },
  });
  act(() => {
    jest.advanceTimersByTime(500);
  });
}

/**
 * Every scroll the strip performed. The component schedules from two separate
 * effects, so the same offset can legitimately arrive more than once — assert
 * on the offsets rather than the call count.
 */
const scrolledOffsets = () =>
  Array.from(new Set(scrollToSpy.mock.calls.map((call) => call[0].x)));

describe("EventsList centering", () => {
  it("centers the most recent past event when no date is selected", () => {
    renderStrip();
    measureViewport();

    // The most recent PAST event, not the nearer future one.
    expect(scrolledOffsets()).toEqual([centeredOffset(3)]);
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ animated: false })
    );
  });

  it("centers the selected event instead", () => {
    renderStrip(new Date(now + 7 * DAY).toISOString());
    measureViewport();

    expect(scrolledOffsets()).toEqual([centeredOffset(4)]);
  });

  it("prefers today's event over the most recent past one", () => {
    mockUseQuery.mockReturnValue([
      meeting("future", "Next week", 7),
      meeting("today", "Today", 0),
      meeting("past", "Two weeks ago", -14),
    ]);

    renderStrip();
    measureViewport();

    // Ascending: [past, today, future] — today is index 1.
    expect(scrolledOffsets()).toEqual([centeredOffset(1)]);
  });

  it("falls back to the first future event when nothing is past", () => {
    mockUseQuery.mockReturnValue([
      meeting("later", "In three weeks", 21),
      meeting("soon", "Next week", 7),
    ]);

    renderStrip();
    measureViewport();

    // Ascending: [soon, later] — the closest future event is index 0, which
    // clamps to the strip's leading edge. Still a scroll, unlike the cases
    // below where none happens at all.
    expect(scrollToSpy).toHaveBeenCalled();
    expect(scrolledOffsets()).toEqual([centeredOffset(0)]);
  });

  it("does not scroll until the viewport has been measured", () => {
    renderStrip();
    // No layout event: width is still 0, so any offset would be meaningless.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("does not scroll when there are no events", () => {
    mockUseQuery.mockReturnValue([]);
    renderStrip();

    // The empty state replaces the strip entirely.
    expect(screen.queryByTestId("events-list-viewport")).toBeNull();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
