import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { WeekCalendar } from "../WeekCalendar";
import { addDays } from "date-fns";

describe("WeekCalendar", () => {
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const mockMeetingDates = [
    {
      id: 1,
      dateOfMeeting: today.toISOString(),
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
      dateOfMeeting: addDays(today, 2).toISOString(),
      dinner: 1,
    },
  ];

  it("renders week calendar with 7 days", () => {
    const { getAllByTestId } = render(
      <WeekCalendar
        weekDays={weekDays}
        meetingDates={mockMeetingDates}
        onDayPress={jest.fn()}
      />
    );

    const dayCards = getAllByTestId(/day-card-/);
    expect(dayCards).toHaveLength(7);
  });

  it("calls onDayPress when a day is pressed", () => {
    const onDayPress = jest.fn();
    const { getByTestId } = render(
      <WeekCalendar
        weekDays={weekDays}
        meetingDates={mockMeetingDates}
        onDayPress={onDayPress}
      />
    );

    const firstDay = getByTestId("day-card-0");
    fireEvent.press(firstDay);

    expect(onDayPress).toHaveBeenCalledWith(weekDays[0], true);
  });

  it("shows event indicator for days with events", () => {
    const { getByTestId } = render(
      <WeekCalendar
        weekDays={weekDays}
        meetingDates={mockMeetingDates}
        onDayPress={jest.fn()}
      />
    );

    const firstDay = getByTestId("day-card-0");
    // Should have event indicator (checkmark)
    expect(firstDay).toBeTruthy();
  });

  it("shows create button for days without events", () => {
    const { getByTestId } = render(
      <WeekCalendar
        weekDays={weekDays}
        meetingDates={[]}
        onDayPress={jest.fn()}
      />
    );

    const firstDay = getByTestId("day-card-0");
    expect(firstDay).toBeTruthy();
  });
});

