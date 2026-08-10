/**
 * EditScopeModal tests
 *
 * The scope picker used to be an imperative ActionSheetIOS / Alert prompt.
 * Both can fail to appear — Alert.alert is a no-op on React Native Web, and
 * the native sheet is presented from the root view controller while Edit Event
 * lives inside the `(user)` modal stack — leaving "Save Changes" waiting on a
 * callback that never fires. These lock in that the options render in the
 * React tree and that choosing one reports the right scope.
 */

import React from "react";
import { render, fireEvent, screen } from "@testing-library/react-native";
import { EditScopeModal } from "../EditScopeModal";

describe("EditScopeModal", () => {
  const baseProps = {
    visible: true,
    isCommunityWide: false,
    isInSeries: false,
    onSelect: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it("renders the options in the React tree, not a native action sheet", () => {
    render(<EditScopeModal {...baseProps} isInSeries />);

    // Visible to the test renderer at all == rendered in-tree.
    expect(screen.getByText("This event only")).toBeTruthy();
    expect(screen.getByText("All events in this series")).toBeTruthy();
  });

  it("offers the cross-group scope only for community-wide events", () => {
    const { rerender } = render(<EditScopeModal {...baseProps} isInSeries />);
    expect(screen.queryByText("All groups on this date")).toBeNull();

    rerender(<EditScopeModal {...baseProps} isInSeries isCommunityWide />);
    expect(screen.getByText("All groups on this date")).toBeTruthy();
  });

  it("offers the series scope only when the event is in a series", () => {
    const { rerender } = render(<EditScopeModal {...baseProps} />);
    expect(screen.queryByText("All events in this series")).toBeNull();

    rerender(<EditScopeModal {...baseProps} isInSeries />);
    expect(screen.getByText("All events in this series")).toBeTruthy();
  });

  it("reports the chosen scope", () => {
    const onSelect = jest.fn();
    render(
      <EditScopeModal
        {...baseProps}
        isInSeries
        isCommunityWide
        onSelect={onSelect}
      />
    );

    fireEvent.press(screen.getByText("All events in this series"));
    expect(onSelect).toHaveBeenCalledWith("all_in_series");

    fireEvent.press(screen.getByText("All groups on this date"));
    expect(onSelect).toHaveBeenCalledWith("this_date_all_groups");

    fireEvent.press(screen.getByText("This event only"));
    expect(onSelect).toHaveBeenCalledWith("this_only");
  });

  it("titles itself for the action being scoped", () => {
    const { rerender } = render(<EditScopeModal {...baseProps} isInSeries />);
    expect(screen.getByText("Edit which events?")).toBeTruthy();

    rerender(
      <EditScopeModal {...baseProps} isInSeries actionLabel="Cancel" />
    );
    expect(screen.getByText("Cancel which events?")).toBeTruthy();
  });

  it("renders nothing to press when hidden", () => {
    render(<EditScopeModal {...baseProps} isInSeries visible={false} />);
    expect(screen.queryByText("This event only")).toBeNull();
  });
});
