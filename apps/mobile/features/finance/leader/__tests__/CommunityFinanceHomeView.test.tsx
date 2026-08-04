/**
 * CommunityFinanceHomeView — the community Finance home.
 *
 * What these pin is the thing the founder's staging pass found missing: a
 * screen that answers "how much money does this community have, and which
 * groups can receive it?", with the enable-giving action ON it rather than
 * described in prose pointing somewhere else.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CommunityFinanceHomeView } from "../CommunityFinanceHomeView";
import type { CommunityFinanceOverview } from "../types";

function makeOverview(
  overrides: Partial<CommunityFinanceOverview> = {},
): CommunityFinanceOverview {
  return {
    onboardingStatus: "live",
    canEnableGiving: true,
    provider: {
      name: "privacy",
      connected: true,
      accountLabel: "Grace Church Ops",
      status: "active",
    },
    totals: {
      balanceCents: 35_000,
      monthDonatedCents: 5_000,
      monthSpentCents: 1_800,
      cardCount: 1,
      fundCount: 2,
    },
    funds: [
      {
        fundId: "fund-general",
        groupId: null,
        groupName: null,
        fundName: "General Fund",
        type: "general",
        status: "active",
        balanceCents: 10_000,
        monthDonatedCents: 1_000,
        monthSpentCents: 600,
        cardCount: 0,
      },
      {
        fundId: "fund-worship",
        groupId: "group-worship",
        groupName: "Worship Team",
        fundName: "Worship Team Fund",
        type: "group",
        status: "active",
        balanceCents: 25_000,
        monthDonatedCents: 4_000,
        monthSpentCents: 1_200,
        cardCount: 1,
      },
    ],
    groupsWithoutFunds: [{ groupId: "group-youth", groupName: "Youth" }],
    financeGrantCount: 1,
    ...overrides,
  };
}

const baseProps = {
  state: "ready" as const,
  overview: makeOverview(),
  onOpenFund: jest.fn(),
  onEnableGiving: jest.fn(),
  enablingGroupId: null,
  onOpenCardProvider: jest.fn(),
  onOpenFinancialControls: jest.fn(),
  onOpenOrganizationDetails: jest.fn(),
};

describe("CommunityFinanceHomeView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("overview header", () => {
    it("leads with the community's total balance and this month's movement", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);

      expect(screen.getByTestId("community-finance-total-balance")).toBeTruthy();
      expect(screen.getByText("$350.00")).toBeTruthy();
      expect(screen.getByText("Across 2 funds")).toBeTruthy();
      expect(
        screen.getByText("$50.00 given · $18.00 spent this month"),
      ).toBeTruthy();
    });

    it("says 'fund' rather than 'funds' when there is one", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            totals: { ...makeOverview().totals, fundCount: 1 },
          })}
        />,
      );
      expect(screen.getByText("Across 1 fund")).toBeTruthy();
    });
  });

  describe("groups & funds", () => {
    it("gives each fund its balance, month spend and live card count in one line", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);

      expect(screen.getByText("Worship Team")).toBeTruthy();
      expect(
        screen.getByText("$250.00 · $12.00 spent this month · 1 card"),
      ).toBeTruthy();
      // No cards -> the clause is dropped, not rendered as "0 cards".
      expect(screen.getByText("$100.00 · $6.00 spent this month")).toBeTruthy();
    });

    it("opens a group's fund settings when its row is tapped", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);
      fireEvent.press(screen.getByTestId("community-finance-fund-fund-worship"));
      expect(baseProps.onOpenFund).toHaveBeenCalledWith("group-worship");
    });

    it("leaves the general fund inert — it has no group hub to open", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);
      fireEvent.press(screen.getByTestId("community-finance-fund-fund-general"));
      expect(baseProps.onOpenFund).not.toHaveBeenCalled();
    });

    it("offers Enable giving on a group that has no fund", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);

      expect(screen.getByText("Youth")).toBeTruthy();
      expect(screen.getByText("Enable giving")).toBeTruthy();
      fireEvent.press(screen.getByTestId("community-finance-enable-group-youth"));
      expect(baseProps.onEnableGiving).toHaveBeenCalledWith("group-youth");
    });

    it("shows the row as in-flight while its mutation runs", () => {
      render(
        <CommunityFinanceHomeView {...baseProps} enablingGroupId="group-youth" />,
      );
      expect(screen.getByText("Enabling…")).toBeTruthy();
      fireEvent.press(screen.getByTestId("community-finance-enable-group-youth"));
      expect(baseProps.onEnableGiving).not.toHaveBeenCalled();
    });

    // enableGroupGiving's own first precondition, restated BEFORE the tap.
    it("refuses to offer Enable giving until the community's giving is live, and says why", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            onboardingStatus: "verifying",
            canEnableGiving: false,
          })}
        />,
      );

      expect(screen.getByText(/isn't finished yet/i)).toBeTruthy();
      expect(screen.queryByText("Enable giving")).toBeNull();
      fireEvent.press(screen.getByTestId("community-finance-enable-group-youth"));
      expect(baseProps.onEnableGiving).not.toHaveBeenCalled();
    });

    // The server's `canEnableGiving` is the authority, not the status the
    // screen happens to be able to read: `enableGroupGiving` also refuses an
    // archived community, which "live" cannot explain. The action still has
    // to be withheld, with words rather than a status the row can't map.
    it("withholds the action whenever the server says it would be refused", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            onboardingStatus: "live",
            canEnableGiving: false,
          })}
        />,
      );

      expect(screen.getByText(/can't be enabled/i)).toBeTruthy();
      expect(screen.queryByText("Enable giving")).toBeNull();
      fireEvent.press(screen.getByTestId("community-finance-enable-group-youth"));
      expect(baseProps.onEnableGiving).not.toHaveBeenCalled();
    });
  });

  describe("setup rows", () => {
    it("names the provider and its connection state inline", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);
      expect(screen.getByText("Privacy.com · Connected")).toBeTruthy();

      fireEvent.press(screen.getByTestId("community-finance-card-provider"));
      expect(baseProps.onOpenCardProvider).toHaveBeenCalled();
    });

    it("says 'Not connected' when no provider has been chosen", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            provider: {
              name: "none",
              connected: false,
              accountLabel: null,
              status: null,
            },
          })}
        />,
      );
      expect(screen.getByText("Not connected")).toBeTruthy();
    });

    // The primary admin holds financial controls with no grant row at all, so
    // the count must never read as the whole population.
    it("counts financial-controls holders without forgetting the primary admins", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);
      expect(screen.getByText("Primary admins, plus 1 other")).toBeTruthy();

      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({ financeGrantCount: 0 })}
        />,
      );
      expect(screen.getByText("Primary admins only")).toBeTruthy();
    });

    // The intake form re-runs onboarding (`startOnboarding` drops the status
    // back to "collecting"), which stops new donations until verification
    // clears. The row stays — a wrong EIN has to be fixable — but the
    // consequence is stated BEFORE the tap that causes it, not after.
    it("warns that editing the organization's details pauses giving, and only then opens the form", () => {
      render(<CommunityFinanceHomeView {...baseProps} />);
      expect(screen.getByText("Organization details")).toBeTruthy();

      fireEvent.press(
        screen.getByTestId("community-finance-organization-details"),
      );
      expect(baseProps.onOpenOrganizationDetails).not.toHaveBeenCalled();
      expect(screen.getByText(/can't take new donations/i)).toBeTruthy();

      fireEvent.press(screen.getByText("Edit details"));
      expect(baseProps.onOpenOrganizationDetails).toHaveBeenCalled();
    });

    // Community-agnostic copy: generic surfaces say "community", never "church".
    it("never calls the community a church", () => {
      const { toJSON } = render(<CommunityFinanceHomeView {...baseProps} />);
      expect(JSON.stringify(toJSON())).not.toMatch(/church/i);
    });
  });

  describe("empty and gated states", () => {
    it("renders a skeleton while the overview is loading", () => {
      render(
        <CommunityFinanceHomeView {...baseProps} state="loading" overview={undefined} />,
      );
      expect(screen.getByTestId("community-finance-home-loading")).toBeTruthy();
    });

    it("explains the refusal rather than showing an empty screen", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          state="not-allowed"
          overview={undefined}
        />,
      );
      expect(screen.getByTestId("community-finance-home-not-allowed")).toBeTruthy();
      expect(screen.getByText("You need financial-controls access")).toBeTruthy();
    });

    it("a community with no funds yet still lists every group it could enable", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            funds: [],
            totals: {
              balanceCents: 0,
              monthDonatedCents: 0,
              monthSpentCents: 0,
              cardCount: 0,
              fundCount: 0,
            },
            groupsWithoutFunds: [
              { groupId: "group-worship", groupName: "Worship Team" },
              { groupId: "group-youth", groupName: "Youth" },
            ],
          })}
        />,
      );

      expect(screen.getByText("$0.00")).toBeTruthy();
      expect(screen.getAllByText("Enable giving")).toHaveLength(2);
    });

    it("says so plainly when the community has no groups at all", () => {
      render(
        <CommunityFinanceHomeView
          {...baseProps}
          overview={makeOverview({
            funds: [],
            groupsWithoutFunds: [],
            totals: {
              balanceCents: 0,
              monthDonatedCents: 0,
              monthSpentCents: 0,
              cardCount: 0,
              fundCount: 0,
            },
          })}
        />,
      );
      expect(screen.getByText("This community has no groups yet.")).toBeTruthy();
    });
  });
});
