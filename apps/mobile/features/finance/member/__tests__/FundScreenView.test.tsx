import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FundScreenView } from "../FundScreenView";
import type { FundOverview, MyExpense } from "../types";
import type { RecurringSummary } from "../recurring";
import { formatCents, formatSignedCents } from "../../format";

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      text: "#111",
      textSecondary: "#666",
      textTertiary: "#999",
      textInverse: "#fff",
      border: "#e0e0e0",
      buttonPrimary: "#222",
      buttonSecondary: "#fafafa",
      buttonDisabled: "#ccc",
      success: "#2e7d32",
      error: "#c00",
      warning: "#e0a800",
      link: "#06f",
      destructive: "#c00",
      iconSecondary: "#999",
      separator: "#e0e0e0",
      backgroundGrouped: "#F2F2F2",
      surfaceGrouped: "#FFFFFF",
      buttonPrimaryText: "#fff",
    },
    isDark: false,
  }),
}));

jest.mock("@components/ui", () => {
  const ReactActual = jest.requireActual("react");
  const RN = jest.requireActual("react-native");
  return {
    Badge: ({ children }: any) => ReactActual.createElement(RN.Text, null, children),
    Button: ({ children, onPress, disabled }: any) =>
      ReactActual.createElement(
        RN.TouchableOpacity,
        { onPress, disabled, accessibilityState: { disabled } },
        ReactActual.createElement(RN.Text, null, children),
      ),
    Skeleton: (props: any) =>
      ReactActual.createElement(RN.View, { testID: "skeleton", ...props }),
    EmptyState: ({ title, message }: any) =>
      ReactActual.createElement(
        RN.View,
        null,
        ReactActual.createElement(RN.Text, null, title),
        message ? ReactActual.createElement(RN.Text, null, message) : null,
      ),
  };
});

const baseOverview: FundOverview = {
  fund: { id: "fund1", name: "Small Group Fund", status: "active" },
  balanceCents: 123456,
  monthToDate: {
    donationsCents: 5000,
    spentCents: 2000,
    feesCents: 175,
    refundedCents: 0,
    donationCount: 2,
  },
  yearToDate: {
    donationsCents: 50000,
    spentCents: 20000,
    feesCents: 1810,
    refundedCents: 0,
    donationCount: 12,
  },
  activity: [
    {
      id: "e1",
      kind: "donation",
      amountCents: 5000,
      direction: "credit",
      createdAt: 1000,
      donorName: "Jane Smith",
    },
    {
      id: "e2",
      kind: "card_capture",
      amountCents: 1200,
      direction: "debit",
      createdAt: 900,
    },
  ],
  viewerCanSeeDonorNames: true,
};

const baseExpenses: MyExpense[] = [
  {
    id: "exp1",
    amountCents: 3000,
    kind: "reimbursement",
    description: "Snacks",
    status: "pending",
    receiptUrl: undefined,
    createdAt: 1,
    updatedAt: 1,
  },
];

const noop = () => {};

describe("FundScreenView", () => {
  it("shows a loading skeleton while overview is undefined", () => {
    render(
      <FundScreenView
        overview={undefined}
        myExpenses={undefined}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows the empty state when giving isn't set up", () => {
    render(
      <FundScreenView
        overview={null}
        myExpenses={undefined}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Giving isn't set up for this group yet")).toBeTruthy();
  });

  it("formats the balance via formatCents", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText(formatCents(123456))).toBeTruthy();
  });

  it("shows card fees on their own line instead of inflating 'spent'", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );

    // MTD spent stays $20.00 — the group's own outgoings — and the $1.75
    // Stripe kept is named rather than counted as spending.
    expect(screen.getByText(/\$20\.00 spent/)).toBeTruthy();
    expect(screen.getByText("$1.75 card fees")).toBeTruthy();
    expect(screen.getByText("$18.10 card fees")).toBeTruthy();
  });

  it("omits the fees line when a period had none", () => {
    render(
      <FundScreenView
        overview={{
          ...baseOverview,
          monthToDate: { ...baseOverview.monthToDate, feesCents: 0 },
          yearToDate: { ...baseOverview.yearToDate, feesCents: 0 },
        }}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );

    expect(screen.queryByText(/card fees/)).toBeNull();
  });

  it("titles an activity row with the donor and captions it with kind + date", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Jane Smith")).toBeTruthy();
    expect(screen.getByText(/^Donation · /)).toBeTruthy();
    expect(screen.getByText(formatSignedCents(5000, "credit"))).toBeTruthy();
    expect(screen.getByText(formatSignedCents(1200, "debit"))).toBeTruthy();
  });

  // An anonymized debit has no name to lead with, so the kind has to serve as
  // the title — otherwise the row opens with a blank line.
  it("falls back to the ledger kind as the title when there's no donor name", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Card purchase")).toBeTruthy();
    expect(screen.getByText(/^Card purchase · /)).toBeTruthy();
  });

  it("hides donor names when the overview omits them (viewer isn't manager+)", () => {
    const anonymized: FundOverview = {
      ...baseOverview,
      viewerCanSeeDonorNames: false,
      activity: baseOverview.activity.map(({ donorName: _donorName, ...rest }) => rest),
    };
    render(
      <FundScreenView
        overview={anonymized}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.queryByText("Jane Smith")).toBeNull();
  });

  it("renders my-reimbursements with status badges", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("Snacks")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("offers 'Get reimbursed' as a cell in the reimbursements card, not in the hero", () => {
    const onGetReimbursedPress = jest.fn();
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={onGetReimbursedPress}
      />,
    );
    fireEvent.press(screen.getByText("Get reimbursed"));
    expect(onGetReimbursedPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Spent for the group? Send the receipt.")).toBeTruthy();
  });

  it("says so plainly when the viewer has no reimbursement requests", () => {
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={[]}
        onBack={noop}
        onGivePress={noop}
        onGetReimbursedPress={noop}
      />,
    );
    expect(screen.getByText("No requests yet")).toBeTruthy();
  });

  // `onManagePress` IS the permission gate — a member without it must not see
  // the leader hub exists at all.
  describe("Fund settings", () => {
    const renderWithManage = (onManagePress?: () => void) =>
      render(
        <FundScreenView
          overview={baseOverview}
          myExpenses={baseExpenses}
          onBack={noop}
          onGivePress={noop}
          onGetReimbursedPress={noop}
          onManagePress={onManagePress}
        />,
      );

    it("is hidden for a viewer who can't manage the fund", () => {
      renderWithManage(undefined);
      expect(screen.queryByText("Fund settings")).toBeNull();
    });

    it("opens the leader hub for a manager", () => {
      const onManagePress = jest.fn();
      renderWithManage(onManagePress);
      expect(screen.getByText("Leaders only")).toBeTruthy();
      fireEvent.press(screen.getByText("Fund settings"));
      expect(onManagePress).toHaveBeenCalledTimes(1);
    });
  });

  // An approved reimbursement is NOT money in flight: the ACH payout is still
  // stubbed (`getPayoutDestination` returns null), so nothing advances the row
  // until a fund manager pays out of band and the status is recorded as paid. The
  // row has to say that rather than leave a bare blue "Approved" badge the
  // reader settles for as "paid".
  describe("approved-but-unpaid honesty", () => {
    const approved: MyExpense[] = [
      { ...baseExpenses[0], id: "exp-approved", status: "approved" },
    ];
    const paid: MyExpense[] = [{ ...baseExpenses[0], id: "exp-paid", status: "paid" }];

    const renderWith = (myExpenses: MyExpense[]) =>
      render(
        <FundScreenView
          overview={baseOverview}
          myExpenses={myExpenses}
          onBack={noop}
          onGivePress={noop}
          onGetReimbursedPress={noop}
        />,
      );

    it("badges an approved reimbursement as awaiting payout, never a bare 'Approved'", () => {
      renderWith(approved);
      expect(screen.getByText("Awaiting payout")).toBeTruthy();
      expect(screen.queryByText("Approved")).toBeNull();
    });

    it("explains who still has to send the money, with no promised date", () => {
      renderWith(approved);
      const note = screen.getByTestId("expense-note-exp-approved");
      // A real role from ADR-032 §4's table — not "treasurer", which the
      // product never labels anyone (see expenseStatusNote's doc comment).
      expect(note.props.children).toMatch(/fund manager/i);
      expect(note.props.children).not.toMatch(/treasurer/i);
      // No ETA language — the payout has no schedule to promise.
      expect(note.props.children).not.toMatch(/\b\d+\s*(day|week|business)/i);
    });

    it("still reads clearly as paid — and differently — once it's actually paid", () => {
      renderWith(paid);
      expect(screen.getByText("Paid")).toBeTruthy();
      expect(screen.queryByText("Awaiting payout")).toBeNull();
      expect(screen.queryByTestId("expense-note-exp-paid")).toBeNull();
    });

    it("leaves pending rows alone", () => {
      renderWith(baseExpenses);
      expect(screen.getByText("Pending")).toBeTruthy();
      expect(screen.queryByTestId("expense-note-exp1")).toBeNull();
    });
  });

  // The monthly box is standing money the donor should be able to see and stop
  // without hunting — but only when there IS one collecting.
  describe("the monthly-giving box", () => {
    const activeMonthly: RecurringSummary = {
      id: "rec1",
      fundId: "fund1",
      groupId: "group1",
      fundName: "Small Group Fund",
      amountCents: 2500,
      feeCoverCents: 0,
      status: "active",
      // 2026-09-01T12:00:00Z, rendered in the runner's local zone.
      currentPeriodEnd: Date.UTC(2026, 8, 1, 12),
      createdAt: 1,
    };

    const renderWith = (
      recurring: RecurringSummary | null | undefined,
      onManageRecurringPress: () => void = noop,
    ) =>
      render(
        <FundScreenView
          overview={baseOverview}
          myExpenses={baseExpenses}
          onBack={noop}
          onGivePress={noop}
          onGetReimbursedPress={noop}
          recurring={recurring}
          onManageRecurringPress={onManageRecurringPress}
        />,
      );

    it("names the gift and where it goes next", () => {
      renderWith(activeMonthly);
      expect(screen.getByText("You give $25.00 monthly")).toBeTruthy();
      expect(screen.getByText(/^Next gift .+ · Manage or cancel$/)).toBeTruthy();
    });

    it("opens the manage screen when tapped", () => {
      const onManageRecurringPress = jest.fn();
      renderWith(activeMonthly, onManageRecurringPress);
      fireEvent.press(screen.getByText("You give $25.00 monthly"));
      expect(onManageRecurringPress).toHaveBeenCalledTimes(1);
    });

    // A failing card is the one thing on this screen a donor has to act on —
    // "Next gift Sep 1" over a declined payment would stop them fixing it.
    it("swaps the sub-line for the fix-it prompt when the payment failed", () => {
      renderWith({ ...activeMonthly, status: "past_due" });
      expect(screen.getByText("Payment issue — tap to fix")).toBeTruthy();
      expect(screen.queryByText(/Next gift/)).toBeNull();
    });

    it("colors that sub-line as a warning rather than leaving it neutral gray", () => {
      renderWith({ ...activeMonthly, status: "past_due" });
      const line = screen.getByText("Payment issue — tap to fix");
      // `warning` from the theme mock above.
      expect(line.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: "#e0a800" })]),
      );
    });

    // A gift still inside Stripe Checkout has charged nothing yet, and a
    // canceled one has nothing left to manage. Neither gets a box.
    it("renders nothing at all for a pending gift", () => {
      renderWith({ ...activeMonthly, status: "pending" });
      expect(screen.queryByTestId("fund-monthly-box")).toBeNull();
      expect(screen.queryByText(/You give/)).toBeNull();
    });

    it("renders nothing at all for a canceled gift", () => {
      renderWith({ ...activeMonthly, status: "canceled" });
      expect(screen.queryByTestId("fund-monthly-box")).toBeNull();
    });

    it("renders nothing when the donor has no monthly gift", () => {
      renderWith(null);
      expect(screen.queryByTestId("fund-monthly-box")).toBeNull();
    });

    it("renders nothing while the query is still loading", () => {
      renderWith(undefined);
      expect(screen.queryByTestId("fund-monthly-box")).toBeNull();
    });

    // Stripe hasn't reported a period on a just-bound gift; the row still has
    // to be usable rather than printing a fabricated date.
    it("drops the date when there isn't one yet", () => {
      renderWith({ ...activeMonthly, currentPeriodEnd: null });
      expect(screen.getByText("Manage or cancel")).toBeTruthy();
    });
  });

  it("fires onGivePress from the hero's single primary pill", () => {
    const onGivePress = jest.fn();
    render(
      <FundScreenView
        overview={baseOverview}
        myExpenses={baseExpenses}
        onBack={noop}
        onGivePress={onGivePress}
        onGetReimbursedPress={noop}
      />,
    );
    fireEvent.press(screen.getByLabelText("Give"));
    expect(onGivePress).toHaveBeenCalled();
  });
});
