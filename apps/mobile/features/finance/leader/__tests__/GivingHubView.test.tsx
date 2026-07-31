import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GivingHubView } from "../GivingHubView";
import type { FundCard, GivingExpense, GivingHubBalanceSummary } from "../types";

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

function makeCard(overrides: Partial<FundCard> = {}): FundCard {
  return {
    id: "card-1",
    name: "Groceries & supplies",
    holderUserId: "user-2",
    holderName: "Carol Williams",
    last4: "4921",
    status: "active",
    spendLimitCents: 25000,
    limitPeriod: "week",
    createdAt: Date.now(),
    ...overrides,
  };
}

const balance: GivingHubBalanceSummary = {
  fundName: "Just the 2 of us",
  balanceCents: 128450,
  monthDonationsCents: 64000,
  monthDonationCount: 12,
  monthSpentCents: 21238,
  monthFeesCents: 1886,
};

const baseProps = {
  state: "ready" as const,
  groupName: "Young Adults",
  givingLive: true,
  balance,
  cards: [] as FundCard[],
  isLoadingCards: false,
  canManageCards: true,
  expenses: [] as GivingExpense[],
  isLoadingExpenses: false,
  canApprove: true,
  currentUserId: "leader-1",
  processingExpenseId: null,
  onApprove: jest.fn(),
  onDeny: jest.fn(),
  activity: [],
  onEnableGiving: jest.fn(),
  isEnablingGiving: false,
  onViewRoles: jest.fn(),
  onGivePress: jest.fn(),
  onReimbursePress: jest.fn(),
  onCreateCardPress: jest.fn(),
  onSharePress: jest.fn(),
  onViewCard: jest.fn(),
  onViewAllActivity: jest.fn(),
};

describe("GivingHubView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("balance header", () => {
    it("renders the fund balance and 'Giving is live' chip", () => {
      render(<GivingHubView {...baseProps} />);

      expect(screen.getByText("$1,284.50")).toBeTruthy();
      expect(screen.getByText("Giving is live")).toBeTruthy();
      expect(screen.getByText("$640.00")).toBeTruthy();
    });

    it("shows Stripe fees beside 'spent' rather than folded into it", () => {
      render(<GivingHubView {...baseProps} />);

      // Spend is the group's own outgoings only ($212.38). The processing
      // fees Stripe kept ($18.86) get their own line — a fee bucketed into
      // "spent" reports spending on a group that spent nothing, and a fee
      // shown nowhere leaves "given" minus "spent" not reconciling.
      expect(screen.getByText("$212.38")).toBeTruthy();
      expect(screen.getByText("+ $18.86 fees")).toBeTruthy();
    });

    it("omits the fees line entirely when there are none", () => {
      render(
        <GivingHubView {...baseProps} balance={{ ...balance, monthFeesCents: 0 }} />,
      );

      expect(screen.queryByText(/fees/)).toBeNull();
    });

    it("hides the 'Giving is live' chip when givingLive is false", () => {
      render(<GivingHubView {...baseProps} givingLive={false} />);

      expect(screen.queryByText("Giving is live")).toBeNull();
    });
  });

  describe("quick actions", () => {
    it("calls onGivePress and onReimbursePress when tapped", () => {
      const onGivePress = jest.fn();
      const onReimbursePress = jest.fn();
      render(<GivingHubView {...baseProps} onGivePress={onGivePress} onReimbursePress={onReimbursePress} />);

      fireEvent.press(screen.getByTestId("giving-hub-action-give"));
      fireEvent.press(screen.getByTestId("giving-hub-action-reimburse"));

      expect(onGivePress).toHaveBeenCalled();
      expect(onReimbursePress).toHaveBeenCalled();
    });

    it("hides Share fund when onSharePress is undefined", () => {
      render(<GivingHubView {...baseProps} onSharePress={undefined} />);

      expect(screen.queryByTestId("giving-hub-action-share")).toBeNull();
    });
  });

  describe("cards", () => {
    it("renders card rows with holder, limit, and status badge", () => {
      render(<GivingHubView {...baseProps} cards={[makeCard()]} />);

      expect(screen.getByText("Groceries & supplies ·· 4921")).toBeTruthy();
      expect(screen.getByText("Carol Williams · $250.00 / week")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
    });

    it("shows a Frozen badge for a disabled card", () => {
      render(<GivingHubView {...baseProps} cards={[makeCard({ status: "disabled" })]} />);

      expect(screen.getByText("Frozen")).toBeTruthy();
    });

    it("calls onViewCard when a card row is pressed", () => {
      const onViewCard = jest.fn();
      render(<GivingHubView {...baseProps} cards={[makeCard()]} onViewCard={onViewCard} />);

      fireEvent.press(screen.getByTestId("giving-hub-card-card-1"));
      expect(onViewCard).toHaveBeenCalledWith("card-1");
    });

    it("shows the 'Create a virtual card…' action and New card tile when canManageCards is true", () => {
      render(<GivingHubView {...baseProps} canManageCards />);

      expect(screen.getByTestId("giving-hub-action-new-card")).toBeTruthy();
      expect(screen.getByTestId("giving-hub-create-card")).toBeTruthy();
    });

    it("hides the create-card affordances when canManageCards is false", () => {
      render(<GivingHubView {...baseProps} canManageCards={false} cards={[]} />);

      expect(screen.queryByTestId("giving-hub-action-new-card")).toBeNull();
      expect(screen.queryByTestId("giving-hub-create-card")).toBeNull();
      expect(screen.getByText("No cards yet")).toBeTruthy();
    });

    it("calls onCreateCardPress when the create-card row is pressed", () => {
      const onCreateCardPress = jest.fn();
      render(<GivingHubView {...baseProps} onCreateCardPress={onCreateCardPress} />);

      fireEvent.press(screen.getByTestId("giving-hub-create-card"));
      expect(onCreateCardPress).toHaveBeenCalled();
    });
  });

  describe("approvals", () => {
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

    it("flags a card charge missing a receipt", () => {
      const expense = makeExpense({ kind: "card_charge", receiptUrl: null, description: "TRADER JOE'S #552" });
      render(<GivingHubView {...baseProps} expenses={[expense]} />);

      expect(screen.getByText("receipt missing")).toBeTruthy();
    });

    it("shows 'No pending approvals' when there are no pending expenses", () => {
      render(<GivingHubView {...baseProps} expenses={[]} />);

      expect(screen.getByText("No pending approvals")).toBeTruthy();
    });
  });

  describe("top-level states", () => {
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
});
