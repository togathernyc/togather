import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { SubmitAttendance } from "@features/leader-tools/components/modals/SubmitAttendance";

describe("SubmitAttendance", () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onSubmit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders when visible", () => {
    render(<SubmitAttendance {...defaultProps} />);
    expect(screen.getByText("Submit Attendance?")).toBeTruthy();
  });

  it("does not render when not visible", () => {
    render(<SubmitAttendance {...defaultProps} visible={false} />);
    expect(screen.queryByText("Submit Attendance?")).toBeNull();
  });

  it("displays attendance count", () => {
    render(<SubmitAttendance {...defaultProps} attendanceCount={5} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Members Attended")).toBeTruthy();
  });

  it("displays guest count when provided", () => {
    render(
      <SubmitAttendance
        {...defaultProps}
        attendanceCount={5}
        guestCount={2}
      />
    );
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Guests")).toBeTruthy();
  });

  it("does not display guest count when 0", () => {
    render(
      <SubmitAttendance
        {...defaultProps}
        attendanceCount={5}
        guestCount={0}
      />
    );
    expect(screen.queryByText("Guests")).toBeNull();
  });

  it("displays warning message when provided", () => {
    const warningMessage = "Please fill attendance for every member.";
    render(
      <SubmitAttendance {...defaultProps} warningMessage={warningMessage} />
    );
    expect(screen.getByText(warningMessage)).toBeTruthy();
  });

  it("displays info message about submission", () => {
    render(<SubmitAttendance {...defaultProps} />);
    expect(
      screen.getByText(
        "Once submitted, attendance cannot be edited. Please verify all information is correct before submitting."
      )
    ).toBeTruthy();
  });

  it("calls onSubmit when submit button is pressed", () => {
    const onSubmit = jest.fn();
    render(<SubmitAttendance {...defaultProps} onSubmit={onSubmit} />);

    const submitButton = screen.getByText("Submit Attendance");
    fireEvent.press(submitButton);

    expect(onSubmit).toHaveBeenCalled();
  });

  it("calls onClose after submitting", () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <SubmitAttendance {...defaultProps} onClose={onClose} onSubmit={onSubmit} />
    );

    const submitButton = screen.getByText("Submit Attendance");
    fireEvent.press(submitButton);

    expect(onSubmit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel button is pressed", () => {
    const onClose = jest.fn();
    render(<SubmitAttendance {...defaultProps} onClose={onClose} />);

    const cancelButton = screen.getByText("Cancel");
    fireEvent.press(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("displays zero attendance count", () => {
    render(<SubmitAttendance {...defaultProps} attendanceCount={0} />);
    expect(screen.getByText("0")).toBeTruthy();
  });
});

