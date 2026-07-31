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
    // Increase's real reset semantics for per_week — UTC included, because
    // that is when the bank actually resets the window.
    expect(screen.getByText("Resets every Monday at midnight UTC")).toBeTruthy();
  });

  // The sheet must never claim a control the product doesn't have. The limit
  // IS real (Increase enforces it), so it may be stated plainly; a
  // receipt-required toggle is not, so it may not appear at all.
  describe("only claims controls that actually exist", () => {
    it("does not render a receipts-required toggle", () => {
      render(<CreateCardView {...baseProps} />);

      expect(screen.queryByText("Require receipts")).toBeNull();
      expect(
        screen.queryByText("Charges flag for approval until a receipt is attached"),
      ).toBeNull();
      expect(screen.queryByText("On")).toBeNull();
    });

    it("says what a charge actually does — settles, then shows up; no approval promised", () => {
      render(<CreateCardView {...baseProps} />);

      expect(screen.getByText(/settle straight away/i)).toBeTruthy();
      // Assert the CLAIM, not a phrasing: no approval path exists for a
      // card_charge (nothing surfaces one, and canPay refuses the kind), so
      // neither a threshold nor a second approver may be mentioned however
      // it's worded.
      expect(screen.queryByText(/second approver/i)).toBeNull();
      expect(screen.queryByText(/\$200/)).toBeNull();
      expect(screen.queryByText(/sign-off/i)).toBeNull();
    });

    it("warns that a card with no limit can spend the whole fund", () => {
      render(<CreateCardView {...baseProps} limitSelection="none" />);

      expect(screen.getByText(/can spend the fund's whole balance/i)).toBeTruthy();
    });

    it("says the bank enforces the limit once one is set", () => {
      render(<CreateCardView {...baseProps} limitSelection="month" />);

      expect(screen.getByText(/bank declines anything over this limit/i)).toBeTruthy();
    });
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
