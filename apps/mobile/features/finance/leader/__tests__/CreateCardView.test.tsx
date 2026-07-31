import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CreateCardView } from "../CreateCardView";
import type { CardholderCandidate } from "../types";

const candidates: CardholderCandidate[] = [
  { userId: "user-1", name: "Carol Williams", role: "cardholder" },
  { userId: "user-2", name: "Bob Smith", role: "finance_admin" },
];

const baseProps = {
  fundName: "Just the 2 of us",
  fundBalanceCents: 128450,
  candidates,
  isLoadingCandidates: false,
  selectedHolderUserId: null,
  onSelectHolder: jest.fn(),
  onGrantRolePress: jest.fn(),
  name: "",
  onNameChange: jest.fn(),
  limitSelection: "none" as const,
  onChangeLimitSelection: jest.fn(),
  amountText: "",
  onAmountChange: jest.fn(),
  isSubmitting: false,
  error: null,
  canSubmit: false,
  onSubmit: jest.fn(),
  onClose: jest.fn(),
};

describe("CreateCardView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders the cardholder picker with role labels", () => {
    render(<CreateCardView {...baseProps} />);

    expect(screen.getByText("Carol Williams")).toBeTruthy();
    expect(screen.getAllByText("Cardholder").length).toBeGreaterThan(0);
    expect(screen.getByText("Bob Smith")).toBeTruthy();
    expect(screen.getByText("Finance admin")).toBeTruthy();
  });

  it("calls onSelectHolder when a candidate is tapped", () => {
    const onSelectHolder = jest.fn();
    render(<CreateCardView {...baseProps} onSelectHolder={onSelectHolder} />);

    fireEvent.press(screen.getByTestId("cardholder-option-user-1"));
    expect(onSelectHolder).toHaveBeenCalledWith("user-1");
  });

  it("shows an empty state and no candidate rows when there are no eligible cardholders", () => {
    render(<CreateCardView {...baseProps} candidates={[]} />);

    expect(screen.getByText("No eligible cardholders yet")).toBeTruthy();
    expect(screen.queryByTestId("cardholder-option-user-1")).toBeNull();
  });

  it("hides the amount field when the limit selection is None", () => {
    render(<CreateCardView {...baseProps} limitSelection="none" />);

    expect(screen.queryByPlaceholderText("$0.00")).toBeNull();
  });

  it("shows the amount field and a period-specific hint when a limit period is selected", () => {
    render(<CreateCardView {...baseProps} limitSelection="week" />);

    expect(screen.getByPlaceholderText("$0.00")).toBeTruthy();
    expect(screen.getByText("Resets every Monday")).toBeTruthy();
  });

  it("calls onChangeLimitSelection when a segmented option is tapped", () => {
    const onChangeLimitSelection = jest.fn();
    render(<CreateCardView {...baseProps} onChangeLimitSelection={onChangeLimitSelection} />);

    fireEvent.press(screen.getByTestId("limit-option-month"));
    expect(onChangeLimitSelection).toHaveBeenCalledWith("month");
  });

  it("calls onSubmit when Create card is pressed and submission is allowed", () => {
    const onSubmit = jest.fn();
    render(<CreateCardView {...baseProps} onSubmit={onSubmit} canSubmit />);

    fireEvent.press(screen.getByText("Create card"));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not call onSubmit when canSubmit is false", () => {
    const onSubmit = jest.fn();
    render(<CreateCardView {...baseProps} onSubmit={onSubmit} canSubmit={false} />);

    fireEvent.press(screen.getByText("Create card"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
