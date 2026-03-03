import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { EventList } from "../EventList";
import { format } from "date-fns";

describe("EventList", () => {
  const mockMeetingDates = [
    {
      id: 1,
      dateOfMeeting: new Date().toISOString(),
      dinner: 1,
      stats: {
        id: 1,
        totalUserCount: 10,
        completionCount: 8,
        presentCount: 7,
      },
    },
    {
      id: 2,
      dateOfMeeting: new Date(Date.now() + 86400000).toISOString(),
      dinner: 1,
      stats: {
        id: 2,
        totalUserCount: 10,
        completionCount: 6,
        presentCount: 5,
      },
    },
  ];

  it("renders nothing when no events", () => {
    const { queryByText } = render(
      <EventList meetingDates={[]} onEditEvent={jest.fn()} />
    );

    expect(queryByText("SCHEDULED EVENTS")).toBeNull();
  });

  it("renders scheduled events list", () => {
    const { getByText } = render(
      <EventList meetingDates={mockMeetingDates} onEditEvent={jest.fn()} />
    );

    expect(getByText("SCHEDULED EVENTS")).toBeTruthy();
  });

  it("displays event dates and attendance stats", () => {
    const { getByText } = render(
      <EventList meetingDates={mockMeetingDates} onEditEvent={jest.fn()} />
    );

    const firstEventDate = format(
      new Date(mockMeetingDates[0].dateOfMeeting),
      "MMM dd, yyyy 'at' h:mm a"
    );
    expect(getByText(firstEventDate)).toBeTruthy();
    expect(getByText("7 attended")).toBeTruthy();
  });

  it("calls onEditEvent when edit button is pressed", () => {
    const onEditEvent = jest.fn();
    const { getAllByText } = render(
      <EventList meetingDates={mockMeetingDates} onEditEvent={onEditEvent} />
    );

    const editButtons = getAllByText("EDIT");
    fireEvent.press(editButtons[0]);

    expect(onEditEvent).toHaveBeenCalled();
  });

  it("handles events without stats", () => {
    const eventsWithoutStats = [
      {
        id: 1,
        dateOfMeeting: new Date().toISOString(),
        dinner: 1,
      },
    ];

    const { getByText } = render(
      <EventList meetingDates={eventsWithoutStats} onEditEvent={jest.fn()} />
    );

    expect(getByText("SCHEDULED EVENTS")).toBeTruthy();
  });
});

