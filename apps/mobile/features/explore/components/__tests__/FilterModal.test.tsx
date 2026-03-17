import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { FilterModal, FilterState } from "../FilterModal";

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#D4A24E",
  }),
}));

describe("FilterModal - meeting type options", () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    filters: { groupType: null, meetingType: null } as FilterState,
    onFilterChange: jest.fn(),
    groupTypes: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps "In-Person" label to value 1', () => {
    const { getByText } = render(<FilterModal {...defaultProps} />);

    fireEvent.press(getByText("In-Person"));

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith({
      groupType: null,
      meetingType: 1,
    });
  });

  it('maps "Online" label to value 2', () => {
    const { getByText } = render(<FilterModal {...defaultProps} />);

    fireEvent.press(getByText("Online"));

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith({
      groupType: null,
      meetingType: 2,
    });
  });

  it('maps "All" label to value null', () => {
    const { getByText } = render(<FilterModal {...defaultProps} />);

    fireEvent.press(getByText("All"));

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith({
      groupType: null,
      meetingType: null,
    });
  });

  it("does not render when visible is false", () => {
    const { queryByText } = render(
      <FilterModal {...defaultProps} visible={false} />
    );
    expect(queryByText("In-Person")).toBeNull();
    expect(queryByText("Online")).toBeNull();
  });
});
