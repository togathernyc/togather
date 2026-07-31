import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CardDetailView } from "../CardDetailView";
import type { CardDetail } from "../types";

function makeCard(overrides: Partial<CardDetail> = {}): CardDetail {
  return {
    id: "card-1",
    name: "Groceries & supplies",
    holderUserId: "user-1",
    holderName: "Carol Williams",
    last4: "4921",
    status: "active",
    spendLimitCents: 25000,
    limitPeriod: "week",
    createdAt: Date.now(),
    activity: [],
    viewerCanFreeze: true,
    viewerCanUnfreeze: true,
    viewerCanCancel: true,
    ...overrides,
  };
}

const baseProps = {
  card: makeCard(),
  fundName: "Just the 2 of us",
  isFreezing: false,
  onToggleFrozen: jest.fn(),
  isCancelling: false,
  onCancelCard: jest.fn(),
};

describe("CardDetailView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders the card name, masked number, and holder", () => {
    render(<CardDetailView {...baseProps} />);

    expect(screen.getByText("•••• •••• •••• 4921")).toBeTruthy();
    expect(screen.getByText("Carol Williams")).toBeTruthy();
    expect(screen.getByText("$250.00 / week")).toBeTruthy();
  });

  // Same rule as the create sheet: state the limit (Increase enforces it),
  // never state a receipts-required control that doesn't exist.
  it("does not claim a receipts-required control", () => {
    render(<CardDetailView {...baseProps} />);

    expect(screen.queryByText("Receipts required")).toBeNull();
    expect(screen.queryByText("Charge auto-flags until a receipt is attached")).toBeNull();
  });

  it("says the bank enforces the limit, and warns when there isn't one", () => {
    render(<CardDetailView {...baseProps} />);
    expect(screen.getByText(/bank declines anything over this limit/i)).toBeTruthy();

    screen.rerender(
      <CardDetailView
        {...baseProps}
        card={makeCard({ spendLimitCents: null, limitPeriod: null })}
      />,
    );
    expect(screen.getByText(/can spend the fund's whole balance/i)).toBeTruthy();
  });

  it("shows the frozen strip and 'Unfreeze' label when the card is disabled", () => {
    render(<CardDetailView {...baseProps} card={makeCard({ status: "disabled" })} />);

    expect(screen.getByText(/This card is frozen/)).toBeTruthy();
    expect(screen.getByText("Unfreeze")).toBeTruthy();
  });

  it("flags activity rows without a receipt", () => {
    const card = makeCard({
      activity: [
        {
          id: "exp-1",
          amountCents: 4000,
          description: "TRADER JOE'S #552",
          status: "pending",
          receiptAttached: false,
          createdAt: Date.now(),
        },
        {
          id: "exp-2",
          amountCents: 1599,
          description: "COFFEE SHOP NYC",
          status: "paid",
          receiptAttached: true,
          createdAt: Date.now(),
        },
      ],
    });
    render(<CardDetailView {...baseProps} card={card} />);

    expect(screen.getByText("No receipt")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("calls onCancelCard when the destructive row is confirmed", () => {
    const onCancelCard = jest.fn();
    render(<CardDetailView {...baseProps} onCancelCard={onCancelCard} />);

    fireEvent.press(screen.getByTestId("cancel-card-button"));
    fireEvent.press(screen.getByText("Cancel card"));

    expect(onCancelCard).toHaveBeenCalled();
  });

  it("hides the cancel row for a failed card", () => {
    render(<CardDetailView {...baseProps} card={makeCard({ status: "failed" })} />);

    expect(screen.queryByTestId("cancel-card-button")).toBeNull();
  });

  it("renders Reveal number and Add to wallet as disabled with a coming-soon note", () => {
    render(<CardDetailView {...baseProps} />);

    expect(screen.getByText("Reveal number")).toBeTruthy();
    expect(screen.getByText("Add to wallet")).toBeTruthy();
    expect(screen.getByText("Reveal number and Add to wallet are coming soon.")).toBeTruthy();
  });

  it("renders a loading skeleton state while the card is undefined", () => {
    render(<CardDetailView {...baseProps} card={undefined} />);

    expect(screen.queryByTestId("card-art")).toBeNull();
  });

  it("hides the unfreeze control for a disabled card when the viewer can't unfreeze", () => {
    const onToggleFrozen = jest.fn();
    render(
      <CardDetailView
        {...baseProps}
        onToggleFrozen={onToggleFrozen}
        card={makeCard({ status: "disabled", viewerCanUnfreeze: false })}
      />,
    );

    // No pressable freeze/unfreeze control — a non-admin holder who froze
    // their own card must not be able to unfreeze it themselves.
    expect(screen.queryByTestId("card-freeze-action")).toBeNull();
    expect(onToggleFrozen).not.toHaveBeenCalled();
  });

  it("hides the cancel row when the viewer can't cancel", () => {
    render(<CardDetailView {...baseProps} card={makeCard({ viewerCanCancel: false })} />);

    expect(screen.queryByTestId("cancel-card-button")).toBeNull();
  });
});
