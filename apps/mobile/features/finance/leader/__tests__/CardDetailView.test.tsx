import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CardDetailView } from "../CardDetailView";
import type { CardCapabilities, CardDetail } from "../types";

/** Increase's row: nothing reversible, a typed limit, no receipt forwarding. */
function makeCapabilities(overrides: Partial<CardCapabilities> = {}): CardCapabilities {
  return {
    cardCloseReversible: false,
    cardFreezeReversible: true,
    weeklyLimits: true,
    limitRequired: false,
    managedFundLimit: false,
    maxCardsPerFund: null,
    receiptForwarding: false,
    ...overrides,
  };
}

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
    managedLimit: false,
    manualCapCents: null,
    createdAt: Date.now(),
    activity: [],
    capabilities: makeCapabilities(),
    viewerCanFreeze: true,
    viewerCanUnfreeze: true,
    viewerCanCancel: true,
    failureMessage: null,
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

  // The claim, not a phrasing. There is no approval path for a card_charge —
  // no screen surfaces one and canPay refuses the kind — so no wording of
  // "sign-off" or "second approver" may appear on a card surface.
  it("does not claim any approval control over card charges", () => {
    render(<CardDetailView {...baseProps} />);

    expect(screen.getByText(/settle straight away/i)).toBeTruthy();
    expect(screen.queryByText(/second approver/i)).toBeNull();
    expect(screen.queryByText(/\$200/)).toBeNull();
    expect(screen.queryByText(/sign-off/i)).toBeNull();
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

  // ADR-033 Phase 3: "this can't be undone" is simply false at a provider that
  // can reopen a closed card, and overstating finality pushes people towards
  // leaving a card live instead of closing it.
  describe("cancel copy follows the provider's capabilities", () => {
    it("says it can't be undone when closing is irreversible", () => {
      render(<CardDetailView {...baseProps} />);

      fireEvent.press(screen.getByTestId("cancel-card-button"));
      expect(screen.getByText(/This can't be undone/)).toBeTruthy();
    });

    it("says the provider can reopen it when closing is reversible", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ capabilities: makeCapabilities({ cardCloseReversible: true }) })}
        />,
      );

      fireEvent.press(screen.getByTestId("cancel-card-button"));
      expect(screen.getByText(/can reopen a closed card/)).toBeTruthy();
      expect(screen.queryByText(/This can't be undone/)).toBeNull();
    });

    // Group-level surface: the fund's members didn't choose the issuer.
    it("never names the vendor", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ capabilities: makeCapabilities({ cardCloseReversible: true }) })}
        />,
      );

      fireEvent.press(screen.getByTestId("cancel-card-button"));
      expect(screen.queryByText(/BILL/)).toBeNull();
      expect(screen.queryByText(/Privacy\.com/)).toBeNull();
      expect(screen.getByText(/your community's card provider/i)).toBeTruthy();
    });
  });

  describe("managed limits", () => {
    it("renders what's left rather than an amount-per-window", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({
            managedLimit: true,
            limitPeriod: null,
            spendLimitCents: 40000,
            capabilities: makeCapabilities({ managedFundLimit: true }),
          })}
        />,
      );

      expect(screen.getByText("$400.00 left — follows the fund balance")).toBeTruthy();
      expect(screen.queryByText(/undefined/)).toBeNull();
      expect(
        screen.getByText(/keeps this card's limit equal to what's left in the fund/i),
      ).toBeTruthy();
    });

    it("leads with the admin's cap when one is pinned", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({
            managedLimit: true,
            limitPeriod: null,
            spendLimitCents: 15000,
            manualCapCents: 15000,
            capabilities: makeCapabilities({ managedFundLimit: true }),
          })}
        />,
      );

      expect(screen.getByText("Capped at $150.00 — follows the fund balance")).toBeTruthy();
    });

    it("does not claim a finance admin can change a managed limit", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({
            managedLimit: true,
            limitPeriod: null,
            spendLimitCents: 40000,
            capabilities: makeCapabilities({ managedFundLimit: true }),
          })}
        />,
      );

      expect(screen.queryByText(/Only finance admins can change it/)).toBeNull();
    });
  });

  describe("receipt attachment", () => {
    const chargeWithoutReceipt = {
      id: "exp-1",
      amountCents: 4000,
      description: "TRADER JOE'S #552",
      status: "pending" as const,
      receiptAttached: false,
      createdAt: Date.now(),
    };

    it("lets the card's holder add a receipt from the badge", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ activity: [chargeWithoutReceipt] })}
          currentUserId="user-1"
          onAttachReceipt={jest.fn()}
        />,
      );

      expect(screen.getByTestId("add-receipt-exp-1")).toBeTruthy();
    });

    it("stays a plain badge for anyone who isn't the holder", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ activity: [chargeWithoutReceipt] })}
          currentUserId="someone-else"
          onAttachReceipt={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("add-receipt-exp-1")).toBeNull();
      expect(screen.getByText("No receipt")).toBeTruthy();
    });

    it("promises only what the provider does with the file", () => {
      const { rerender } = render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ activity: [chargeWithoutReceipt] })}
          currentUserId="user-1"
          onAttachReceipt={jest.fn()}
        />,
      );

      fireEvent.press(screen.getByTestId("add-receipt-exp-1"));
      expect(screen.getByText("Saved to the fund's record of this charge.")).toBeTruthy();

      rerender(
        <CardDetailView
          {...baseProps}
          card={makeCard({
            activity: [chargeWithoutReceipt],
            capabilities: makeCapabilities({ receiptForwarding: true }),
          })}
          currentUserId="user-1"
          onAttachReceipt={jest.fn()}
        />,
      );
      expect(
        screen.getByText(
          "Saved to the fund and sent on to your community's card provider.",
        ),
      ).toBeTruthy();
    });
  });

  /**
   * A card that never got issued. Both halves come from a real staging
   * failure: Privacy refused with "Insufficient privileges to create UNLOCKED
   * cards" — an account-plan problem the admin could have acted on — and the
   * screen showed a generic apology above a card whose number read "··null".
   */
  describe("a card that failed to issue", () => {
    it("does not render a null where the digits would be", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ status: "failed", last4: null })}
        />,
      );

      expect(screen.queryByText(/null/)).toBeNull();
      expect(screen.getByText("•••• •••• •••• ••••")).toBeTruthy();
    });

    it("surfaces the provider's own reason when the viewer may read it", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({
            status: "failed",
            last4: null,
            failureMessage:
              "Insufficient privileges to create UNLOCKED cards — this account may not have general-purpose cards enabled.",
          })}
        />,
      );

      expect(screen.getByTestId("card-failed-strip")).toBeTruthy();
      expect(
        screen.getByText(/Insufficient privileges to create UNLOCKED cards/),
      ).toBeTruthy();
      expect(
        screen.queryByText(
          "Something went wrong issuing this card. Contact support.",
        ),
      ).toBeNull();
    });

    it("keeps the generic line for a viewer the server gave no reason to", () => {
      render(
        <CardDetailView
          {...baseProps}
          card={makeCard({ status: "failed", last4: null, failureMessage: null })}
        />,
      );

      expect(
        screen.getByText(
          "Something went wrong issuing this card. Contact support.",
        ),
      ).toBeTruthy();
    });
  });
});
