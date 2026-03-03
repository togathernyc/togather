import React from "react";
import { render } from "@testing-library/react-native";
import { AttendanceChart } from "../AttendanceChart";

describe("AttendanceChart", () => {
  const mockAttendanceStats = [
    {
      id: 1,
      date_of_meeting: "2025-11-06T10:00:00Z",
      present_count: 17,
    },
    {
      id: 2,
      date_of_meeting: "2025-11-13T10:00:00Z",
      present_count: 21,
    },
    {
      id: 3,
      date_of_meeting: "2025-11-20T10:00:00Z",
      present_count: 16,
    },
  ];

  it("renders attendance chart with valid data", () => {
    const { getByText } = render(
      <AttendanceChart attendanceStats={mockAttendanceStats} />
    );

    expect(getByText("17")).toBeTruthy();
    expect(getByText("21")).toBeTruthy();
    expect(getByText("16")).toBeTruthy();
  });

  it("handles empty attendance stats", () => {
    const { queryByText } = render(<AttendanceChart attendanceStats={[]} />);
    // Should not render any attendance numbers
    expect(queryByText("17")).toBeNull();
  });

  it("handles null attendance stats", () => {
    const { queryByText } = render(<AttendanceChart attendanceStats={null as any} />);
    // Should not render any attendance numbers
    expect(queryByText("17")).toBeNull();
  });

  it("handles invalid date values gracefully", () => {
    const invalidStats = [
      {
        id: 1,
        date_of_meeting: "invalid-date",
        present_count: 10,
      },
      {
        id: 2,
        date_of_meeting: null,
        present_count: 15,
      },
    ];

    const { getByText } = render(
      <AttendanceChart attendanceStats={invalidStats as any} />
    );

    // Should still render the counts
    expect(getByText("10")).toBeTruthy();
    expect(getByText("15")).toBeTruthy();
  });

  it("handles missing date_of_meeting field", () => {
    const statsWithoutDate = [
      {
        id: 1,
        present_count: 20,
      },
    ];

    const { getByText } = render(
      <AttendanceChart attendanceStats={statsWithoutDate as any} />
    );

    expect(getByText("20")).toBeTruthy();
  });

  it("calculates bar heights correctly based on highest attendance", () => {
    const stats = [
      { id: 1, date_of_meeting: "2025-11-06T10:00:00Z", present_count: 10 },
      { id: 2, date_of_meeting: "2025-11-13T10:00:00Z", present_count: 20 },
      { id: 3, date_of_meeting: "2025-11-20T10:00:00Z", present_count: 5 },
    ];

    const { getByText } = render(
      <AttendanceChart attendanceStats={stats} />
    );

    expect(getByText("10")).toBeTruthy();
    expect(getByText("20")).toBeTruthy();
    expect(getByText("5")).toBeTruthy();
  });
});

