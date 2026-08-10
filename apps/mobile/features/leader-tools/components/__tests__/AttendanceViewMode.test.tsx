/**
 * AttendanceViewMode — the WA-styled read-only report
 * (WHATSAPP-DESIGN-SYSTEM.md §3.2). Covers the facts the redesign is
 * responsible for: one metric strip instead of half-width stat tiles, people
 * as rows, and no placeholder boxes for facts that don't exist.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { AttendanceViewMode } from "../AttendanceViewMode";

const report = {
  attendances: [
    {
      _id: "a1",
      status: 1,
      user: { _id: "u1", first_name: "Jane", last_name: "Smith" },
    },
    {
      _id: "a2",
      status: 0,
      user: { _id: "u2", first_name: "Absent", last_name: "Person" },
    },
  ],
  guests: [
    { id: "g1", first_name: "Guest 1" },
    { id: "g2", first_name: "Rae", last_name: "Nolan", phone_number: "555-0100" },
  ],
  stats: { member_count: 1, guest_count: 2, total_count: 3, prev_diff: 2 },
  note: "Rainy day, smaller crowd",
};

describe("AttendanceViewMode", () => {
  it("renders the headline metrics in one strip", () => {
    const { getByText, getAllByText } = render(
      <AttendanceViewMode isFutureEvent={false} report={report} />
    );

    expect(getByText("Total")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
    // "Members"/"Guests" each appear twice — once as a metric label, once as
    // the section header of the list below.
    expect(getAllByText("Members").length).toBeGreaterThan(0);
    expect(getAllByText("Guests").length).toBeGreaterThan(0);
    // A non-zero change reads as a signed delta against the previous event.
    expect(getByText("+2")).toBeTruthy();
    expect(getByText("vs last")).toBeTruthy();
  });

  it("omits the change metric when nothing changed", () => {
    const { queryByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={{ ...report, stats: { ...report.stats, prev_diff: 0 } }}
      />
    );

    expect(queryByText("vs last")).toBeNull();
  });

  it("lists attended members only, and names guests", () => {
    const { getByText, queryByText } = render(
      <AttendanceViewMode isFutureEvent={false} report={report} />
    );

    expect(getByText("Jane Smith")).toBeTruthy();
    expect(queryByText("Absent Person")).toBeNull();
    expect(getByText("Anonymous guests")).toBeTruthy();
    expect(getByText("Rae Nolan")).toBeTruthy();
  });

  it("handles a guest checked in without a name", () => {
    // Check-in creates the guest row first and lets the leader name it later,
    // so first_name/last_name can both be absent.
    const { getByText, queryByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={{
          ...report,
          guests: [{ id: "g9", phone_number: "555-0101" }],
          stats: { ...report.stats, guest_count: 1 },
        }}
      />
    );

    expect(getByText("Guest")).toBeTruthy();
    expect(queryByText("undefined")).toBeNull();
  });

  it("keeps a guest's phone AND notes visible", () => {
    const { getByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={{
          ...report,
          guests: [
            {
              id: "g8",
              first_name: "Rae",
              last_name: "Nolan",
              phone_number: "555-0100",
              notes: "First visit",
            },
          ],
        }}
      />
    );

    expect(getByText("555-0100 · First visit")).toBeTruthy();
  });

  it("shows the note when there is one and no placeholder when there isn't", () => {
    const { getByText } = render(
      <AttendanceViewMode isFutureEvent={false} report={report} />
    );
    expect(getByText("Rainy day, smaller crowd")).toBeTruthy();

    const { queryByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={{ ...report, note: null }}
      />
    );
    // The old layout rendered a "No note" box that only ever said nothing.
    expect(queryByText("No note")).toBeNull();
  });

  it("stays a short card for an event nobody has recorded yet", () => {
    const { getByText, queryByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={{
          attendances: [],
          guests: [],
          stats: {
            member_count: 0,
            guest_count: 0,
            total_count: 0,
            prev_diff: 0,
          },
          note: null,
        }}
      />
    );

    expect(getByText("No members attended")).toBeTruthy();
    // No guests card at all when there are none, and no change metric.
    expect(queryByText("Anonymous guests")).toBeNull();
    expect(queryByText("vs last")).toBeNull();
    expect(queryByText("Submitted")).toBeNull();
  });

  it("credits the submission when one exists", () => {
    const { getByText } = render(
      <AttendanceViewMode
        isFutureEvent={false}
        report={report}
        submittedDate="2026-07-28T10:00:00.000Z"
        submittedBy={{ first_name: "Jane", last_name: "Smith" }}
      />
    );

    expect(getByText("Submitted Jul 28, 2026 by Jane Smith")).toBeTruthy();
  });

  it("tells the leader to come back for a future event", () => {
    const { getByText, queryByText } = render(
      <AttendanceViewMode isFutureEvent report={report} />
    );

    expect(
      getByText("Wait until the day of the event or after to take attendance")
    ).toBeTruthy();
    expect(queryByText("Total")).toBeNull();
  });
});
