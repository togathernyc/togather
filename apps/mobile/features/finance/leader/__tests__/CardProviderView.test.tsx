import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CardProviderView } from "../CardProviderView";
import type { CardProviderConnection } from "../types";

function makeConnection(
  overrides: Partial<CardProviderConnection> = {},
): CardProviderConnection {
  return {
    provider: "privacy",
    accountLabel: "Grace Church Ops",
    status: "active",
    lastSyncAt: Date.UTC(2026, 6, 27, 12),
    lastError: null,
    connectedAt: Date.UTC(2026, 6, 1, 12),
    ...overrides,
  };
}

const baseProps = {
  state: "ready" as const,
  connection: null,
  connectingProvider: null,
  onOpenConnectSheet: jest.fn(),
  onCloseConnectSheet: jest.fn(),
  apiKey: "",
  onApiKeyChange: jest.fn(),
  isConnecting: false,
  connectError: null,
  onConnect: jest.fn(),
  isConfirmingDisconnect: false,
  onRequestDisconnect: jest.fn(),
  onCancelDisconnect: jest.fn(),
  onConfirmDisconnect: jest.fn(),
  isDisconnecting: false,
  disconnectError: null,
};

describe("CardProviderView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("not connected", () => {
    it("offers both providers with their real capability trade-offs", () => {
      render(<CardProviderView {...baseProps} />);

      expect(screen.getByTestId("card-provider-option-bill")).toBeTruthy();
      expect(screen.getByTestId("card-provider-option-privacy")).toBeTruthy();
      expect(screen.getByText("BILL Spend & Expense")).toBeTruthy();
      expect(screen.getByText("Privacy.com")).toBeTruthy();
      expect(screen.getByText(/a closed card can't be reopened/i)).toBeTruthy();
      expect(screen.getByText(/reopened from BILL/i)).toBeTruthy();
    });

    // ADR-033 §1: without hard fund isolation the pooled balance is the blast
    // radius, so the recommendation has to be on screen BEFORE the choice.
    it("warns that cards draw on one pooled account", () => {
      render(<CardProviderView {...baseProps} />);

      expect(screen.getByText(/ONE pooled account/)).toBeTruthy();
      expect(screen.getByText(/only for Togather group funds/i)).toBeTruthy();
    });

    it("opens the paste sheet for the provider that was tapped", () => {
      const onOpenConnectSheet = jest.fn();
      render(<CardProviderView {...baseProps} onOpenConnectSheet={onOpenConnectSheet} />);

      fireEvent.press(screen.getByTestId("card-provider-option-privacy"));
      expect(onOpenConnectSheet).toHaveBeenCalledWith("privacy");
    });
  });

  describe("paste-credential sheet", () => {
    it("labels the field with the provider's own name for its credential", () => {
      render(<CardProviderView {...baseProps} connectingProvider="bill" />);

      expect(screen.getByText("BILL Spend & Expense API token")).toBeTruthy();
      expect(screen.getByPlaceholderText("Paste API token")).toBeTruthy();

      screen.rerender(<CardProviderView {...baseProps} connectingProvider="privacy" />);
      expect(screen.getByText("Privacy.com API key")).toBeTruthy();
      expect(screen.getByPlaceholderText("Paste API key")).toBeTruthy();
    });

    it("won't submit an empty credential", () => {
      const onConnect = jest.fn();
      render(
        <CardProviderView
          {...baseProps}
          connectingProvider="privacy"
          apiKey="   "
          onConnect={onConnect}
        />,
      );

      fireEvent.press(screen.getByText("Connect"));
      expect(onConnect).not.toHaveBeenCalled();
    });

    it("submits once a credential is pasted", () => {
      const onConnect = jest.fn();
      render(
        <CardProviderView
          {...baseProps}
          connectingProvider="privacy"
          apiKey="live-key"
          onConnect={onConnect}
        />,
      );

      fireEvent.press(screen.getByText("Connect"));
      expect(onConnect).toHaveBeenCalled();
    });

    // The provider's own reason ("account suspended" vs "wrong key") is the
    // only thing that tells an admin what to fix, so it stays on screen next
    // to the field rather than in a toast.
    it("shows the provider's refusal inline", () => {
      render(
        <CardProviderView
          {...baseProps}
          connectingProvider="privacy"
          apiKey="bad-key"
          connectError="Couldn't reach Privacy.com with that API key: 401 Unauthorized"
        />,
      );

      expect(screen.getByTestId("card-provider-connect-error")).toBeTruthy();
      expect(screen.getByText(/401 Unauthorized/)).toBeTruthy();
    });
  });

  describe("connected", () => {
    it("names the account and the vendor", () => {
      render(<CardProviderView {...baseProps} connection={makeConnection()} />);

      expect(screen.getByTestId("card-provider-connected")).toBeTruthy();
      expect(screen.getByText("Connected as Grace Church Ops")).toBeTruthy();
      expect(screen.getByText("Privacy.com")).toBeTruthy();
      expect(screen.getByTestId("card-provider-status-active")).toBeTruthy();
    });

    it("falls back to 'your account' when the provider gave no label", () => {
      render(
        <CardProviderView
          {...baseProps}
          connection={makeConnection({ accountLabel: null })}
        />,
      );

      expect(screen.getByText("Connected as your account")).toBeTruthy();
    });

    it("surfaces the provider's own error text when the connection is broken", () => {
      render(
        <CardProviderView
          {...baseProps}
          connection={makeConnection({
            status: "error",
            lastError: "API key was revoked at Privacy.com",
          })}
        />,
      );

      expect(screen.getByTestId("card-provider-status-error")).toBeTruthy();
      expect(screen.getByText("API key was revoked at Privacy.com")).toBeTruthy();
    });

    it("shows a disconnected connection rather than an empty state", () => {
      render(
        <CardProviderView {...baseProps} connection={makeConnection({ status: "revoked" })} />,
      );

      expect(screen.getByTestId("card-provider-revoked")).toBeTruthy();
      // …and the picker is back, because they can connect again.
      expect(screen.getByTestId("card-provider-option-privacy")).toBeTruthy();
    });

    // The guard names HOW MANY cards and what to do; a toast would take that
    // off screen before the admin could act on it.
    it("puts the live-cards guard inside the confirm dialog", () => {
      render(
        <CardProviderView
          {...baseProps}
          connection={makeConnection()}
          isConfirmingDisconnect
          disconnectError="3 cards are still open at privacy. Close them first — disconnecting now would leave cards spending that Togather can no longer pause or track."
        />,
      );

      expect(screen.getByText(/3 cards are still open/)).toBeTruthy();
      expect(screen.getByText(/Close them first/)).toBeTruthy();
    });

    it("asks before disconnecting", () => {
      const onRequestDisconnect = jest.fn();
      render(
        <CardProviderView
          {...baseProps}
          connection={makeConnection()}
          onRequestDisconnect={onRequestDisconnect}
        />,
      );

      fireEvent.press(screen.getByTestId("card-provider-disconnect"));
      expect(onRequestDisconnect).toHaveBeenCalled();
    });
  });

  it("explains the finance-access gate instead of erroring", () => {
    render(<CardProviderView {...baseProps} state="not-allowed" />);

    expect(screen.getByTestId("card-provider-not-allowed")).toBeTruthy();
    expect(screen.getByText("You need financial-controls access")).toBeTruthy();
    expect(screen.queryByTestId("card-provider-option-privacy")).toBeNull();
  });

  // There is no "reveal key" control and there must never be one — the backend
  // deliberately can't read the credential back. (The connected footer does
  // SAY so in prose, which is why this asserts on controls, not on the word.)
  it("never offers to show the stored credential", () => {
    render(<CardProviderView {...baseProps} connection={makeConnection()} />);

    expect(screen.queryByText("Reveal")).toBeNull();
    expect(screen.queryByText(/show (the |your )?(key|token)/i)).toBeNull();
    expect(screen.queryByText(/copy (the |your )?(key|token)/i)).toBeNull();
  });
});
