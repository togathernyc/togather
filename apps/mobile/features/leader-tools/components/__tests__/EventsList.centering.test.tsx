/**
 * The Attendance event picker scrolls the relevant event card to the middle of
 * the strip. `EventsList.scroll.test.ts` covers the arithmetic in isolation;
 * this covers the wiring around it — which card gets chosen, and that the
 * measured viewport actually reaches the scroll call.
 *
 * Expected offsets are written out longhand from the card metrics (132pt card,
 * 12pt gap, 16pt screen margin) rather than by calling the component's own
 * helper, so a drift in either the metrics or the helper fails this test.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
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

/** Four past events then one future one, oldest first. */
const MEETINGS = [
  { _id: "m0", title: "Four weeks ago", scheduledAt: now - 28 * DAY },
  { _id: "m1", title: "Three weeks ago", scheduledAt: now - 21 * DAY },
  { _id: "m2", title: "Two weeks ago", scheduledAt: now - 14 * DAY },
  { _id: "m3", title: "Last week", scheduledAt: now - 7 * DAY },
  { _id: "m4", title: "Next week", scheduledAt: now + 7 * DAY },
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

/** Render, then report the measured viewport width the component asks for. */
function renderStrip(selectedDate: string | null = null) {
  const utils = render(
    <EventsList groupId="group_1" selectedDate={selectedDate} onEventSelect={jest.fn()} />
  );
  return utils;
}

function measureViewport(getByTestId: (id: string) => unknown) {
  fireEvent(getByTestId("events-list-viewport") as never, "layout", {
    nativeEvent: { layout: { width: VIEWPORT, height: 160 } },
  });
  act(() => {
    jest.advanceTimersByTime(500);
  });
}

describe("EventsList centering", () => {
  it("centers the most recent past event when no date is selected", () => {
    const { getByTestId } = renderStrip();
    measureViewport(getByTestId);

    // "Last week" is index 3 of the ascending strip — the most recent past
    // event, not the future one.
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ x: centeredOffset(3) })
    );
  });

  it("centers the selected event instead", () => {
    const selected = new Date(now + 7 * DAY).toISOString();
    const { getByTestId } = renderStrip(selected);
    measureViewport(getByTestId);

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ x: centeredOffset(4) })
    );
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
    const { queryByTestId } = renderStrip();

    // The empty state replaces the strip entirely.
    expect(queryByTestId("events-list-viewport")).toBeNull();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
