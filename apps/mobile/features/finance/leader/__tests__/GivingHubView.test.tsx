import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GivingHubView } from "../GivingHubView";
import type { GivingExpense } from "../types";

function makeExpense(overrides: Partial<GivingExpense> = {}): GivingExpense {
  return {
    id: "expense-1",
    amountCents: 4250,
    kind: "reimbursement",
    description: "Snacks for small group",
    status: "pending",
    receiptUrl: null,
    approverId: null,
    secondApproverId: null,
    increaseTransferId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    submitter: {
      id: "user-1",
      firstName: "Jamie",
      lastName: "Lee",
      displayName: "Jamie Lee",
      profileImage: null,
    },
    ...overrides,
  };
}

const baseProps = {
  state: "ready" as const,
  groupName: "Young Adults",
  tab: "pending" as const,
  onTabChange: jest.fn(),
  isLoadingExpenses: false,
  canApprove: true,
  currentUserId: "leader-1",
  processingExpenseId: null,
  onApprove: jest.fn(),
  onDeny: jest.fn(),
  onEnableGiving: jest.fn(),
  isEnablingGiving: false,
  onViewRoles: jest.fn(),
};

describe("GivingHubView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows the two-approver state for an expense with one approval already recorded", () => {
    const expense = makeExpense({ approverId: "manager-1", status: "pending" });
    render(<GivingHubView {...baseProps} expenses={[expense]} />);

    expect(screen.getByText("1 of 2 approvals")).toBeTruthy();
  });

  it("does not show the two-approver badge when no approval has been recorded yet", () => {
    const expense = makeExpense({ approverId: null, status: "pending" });
    render(<GivingHubView {...baseProps} expenses={[expense]} />);

    expect(screen.queryByText("1 of 2 approvals")).toBeNull();
  });

  it("hides Approve/Deny controls when the viewer cannot approve", () => {
    const expense = makeExpense();
    render(<GivingHubView {...baseProps} expenses={[expense]} canApprove={false} />);

    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
  });

  it("hides Approve/Deny controls and shows a note for the submitter's own request", () => {
    const expense = makeExpense({ submitter: { ...makeExpense().submitter, id: "leader-1" } });
    render(<GivingHubView {...baseProps} expenses={[expense]} currentUserId="leader-1" />);

    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.getByText("You can't approve your own request.")).toBeTruthy();
  });

  it("calls onApprove with the expense id when Approve is pressed", () => {
    const onApprove = jest.fn();
    const expense = makeExpense();
    render(<GivingHubView {...baseProps} expenses={[expense]} onApprove={onApprove} />);

    fireEvent.press(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledWith("expense-1");
  });

  it("renders the enable-giving CTA for community admins when no fund exists", () => {
    render(<GivingHubView {...baseProps} state="no-fund-admin" expenses={[]} />);

    expect(screen.getByText("Enable giving for this group")).toBeTruthy();
  });

  it("renders an explainer (no CTA) for non-admins when no fund exists", () => {
    render(<GivingHubView {...baseProps} state="no-fund-member" expenses={[]} />);

    expect(screen.queryByText("Enable giving for this group")).toBeNull();
    expect(screen.getByText(/Ask a community admin/)).toBeTruthy();
  });
});
