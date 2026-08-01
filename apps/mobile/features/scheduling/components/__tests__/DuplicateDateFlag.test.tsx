/**
 * The ⚠ on a roster date column that shares its date with another plan.
 *
 * Legacy duplicates already exist in production, so prevention alone isn't
 * enough — two same-date headers are otherwise indistinguishable, which is how
 * a leader authored tasks on one Aug 2 plan while rostered on another.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import {
  DuplicateDateFlag,
  duplicateDateLabel,
} from "../DuplicateDateFlag";

const COLORS = { destructive: "#DC2626" } as never;

describe("duplicateDateLabel", () => {
  it("counts the OTHER plans, not including this one", () => {
    expect(duplicateDateLabel(2)).toContain("1 other plan on this date");
    expect(duplicateDateLabel(3)).toContain("2 other plans on this date");
  });

  it("reuses the grid's existing double-booked vocabulary", () => {
    expect(duplicateDateLabel(2)).toContain("Double-booked");
  });
});

describe("DuplicateDateFlag", () => {
  it("renders nothing for a date with a single plan", () => {
    const { toJSON } = render(
      <DuplicateDateFlag sameDatePlanCount={1} colors={COLORS} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when the count is missing or nonsensical", () => {
    expect(
      render(
        <DuplicateDateFlag sameDatePlanCount={0} colors={COLORS} />,
      ).toJSON(),
    ).toBeNull();

    // The one that actually happens: the production deploy runs the Convex
    // deploy and the mobile OTA in parallel, so a client can pull a bundle
    // that reads `sameDatePlanCount` before the field exists. `undefined <= 1`
    // is false, so failing open flagged EVERY column with "NaN other plans".
    for (const missing of [undefined, null, NaN]) {
      expect(
        render(
          <DuplicateDateFlag
            sameDatePlanCount={missing as unknown as number}
            colors={COLORS}
          />,
        ).toJSON(),
      ).toBeNull();
    }
  });

  it("flags a shared date with an accessible explanation", () => {
    const { getByLabelText } = render(
      <DuplicateDateFlag sameDatePlanCount={2} colors={COLORS} />,
    );
    expect(getByLabelText(duplicateDateLabel(2))).toBeTruthy();
  });

  it("adds the 'Same date' wording only when there is room for it", () => {
    const bare = render(
      <DuplicateDateFlag sameDatePlanCount={2} colors={COLORS} />,
    );
    expect(bare.queryByText("Same date")).toBeNull();

    const labelled = render(
      <DuplicateDateFlag sameDatePlanCount={2} colors={COLORS} withLabel />,
    );
    expect(labelled.getByText("Same date")).toBeTruthy();
  });
});
