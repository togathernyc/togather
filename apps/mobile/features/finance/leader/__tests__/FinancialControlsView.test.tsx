import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FinancialControlsView } from "../FinancialControlsView";
import type { CommunityFinanceRoleRow, FinanceUserSummary } from "../types";

function makeRole(
  overrides: Partial<CommunityFinanceRoleRow> = {},
): CommunityFinanceRoleRow {
  return {
    id: "grant-1",
    userId: "user-1",
    grantedAt: Date.now(),
    revokedAt: null,
    isActive: true,
    user: {
      id: "user-1",
      firstName: "Casey",
      lastName: "Rivera",
      displayName: "Casey Rivera",
      profileImage: null,
    },
    ...overrides,
  };
}

const candidate: FinanceUserSummary = {
  id: "user-9",
  firstName: "Dana",
  lastName: "Okafor",
  displayName: "Dana Okafor",
  profileImage: null,
};

const baseProps = {
  state: "ready" as const,
  roles: [] as CommunityFinanceRoleRow[],
  viewerIsPrimaryAdmin: false,
  isPickerOpen: false,
  onOpenPicker: jest.fn(),
  onClosePicker: jest.fn(),
  grantable: [] as FinanceUserSummary[],
  isLoadingGrantable: false,
  onGrant: jest.fn(),
  isGranting: false,
  grantError: null,
  revokeTargetUserId: null,
  onRequestRevoke: jest.fn(),
  onCancelRevoke: jest.fn(),
  onConfirmRevoke: jest.fn(),
  isRevoking: false,
  revokeError: null,
};

describe("FinancialControlsView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("lists everyone holding financial controls", () => {
    render(<FinancialControlsView {...baseProps} roles={[makeRole()]} />);

    expect(screen.getByTestId("financial-controls-row-user-1")).toBeTruthy();
    expect(screen.getByText("Casey Rivera")).toBeTruthy();
    // Twice: the group header, and the row's own sub-line.
    expect(screen.getAllByText("Financial controls")).toHaveLength(2);
  });

  it("says the primary admin has it when nobody else does", () => {
    render(<FinancialControlsView {...baseProps} roles={[]} />);

    expect(
      screen.getByText("Only the primary admin has financial controls."),
    ).toBeTruthy();
  });

  it("states the rule that answers every question about this screen", () => {
    render(<FinancialControlsView {...baseProps} roles={[makeRole()]} />);

    expect(screen.getByText(/only person who can give or take them/i)).toBeTruthy();
    expect(screen.getByText(/must already be a community admin/i)).toBeTruthy();
  });

  // The mutations are primary-admin-only, so a control here for anyone else
  // could do nothing but error.
  describe("only the primary admin gets controls", () => {
    it("shows the roster and no buttons to a non-primary holder", () => {
      render(<FinancialControlsView {...baseProps} roles={[makeRole()]} />);

      expect(screen.getByTestId("financial-controls-row-user-1")).toBeTruthy();
      expect(screen.queryByTestId("financial-controls-grant-button")).toBeNull();
      expect(screen.queryByTestId("financial-controls-revoke-user-1")).toBeNull();
    });

    it("shows grant and revoke to the primary admin", () => {
      render(
        <FinancialControlsView {...baseProps} roles={[makeRole()]} viewerIsPrimaryAdmin />,
      );

      expect(screen.getByTestId("financial-controls-grant-button")).toBeTruthy();
      expect(screen.getByTestId("financial-controls-revoke-user-1")).toBeTruthy();
    });
  });

  it("opens the picker from the grant action", () => {
    const onOpenPicker = jest.fn();
    render(
      <FinancialControlsView
        {...baseProps}
        viewerIsPrimaryAdmin
        onOpenPicker={onOpenPicker}
      />,
    );

    fireEvent.press(screen.getByTestId("financial-controls-grant-button"));
    expect(onOpenPicker).toHaveBeenCalled();
  });

  describe("grant picker", () => {
    it("lists community admins who don't already hold it", () => {
      const onGrant = jest.fn();
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          isPickerOpen
          grantable={[candidate]}
          onGrant={onGrant}
        />,
      );

      fireEvent.press(screen.getByTestId("financial-controls-candidate-user-9"));
      expect(onGrant).toHaveBeenCalledWith("user-9");
    });

    // The mutation refuses anyone who isn't already a community admin, so the
    // empty state has to point at the fix rather than just say "nobody".
    it("sends the admin to the right screen when there's nobody to grant to", () => {
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          isPickerOpen
          grantable={[]}
        />,
      );

      expect(screen.getByTestId("financial-controls-picker-empty")).toBeTruthy();
      expect(screen.getByText(/make someone\s+an admin first/i)).toBeTruthy();
    });

    it("keeps a refused grant inline in the picker", () => {
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          isPickerOpen
          grantable={[candidate]}
          grantError="Only the community's primary admin can change who has financial-controls access"
        />,
      );

      expect(screen.getByTestId("financial-controls-grant-error")).toBeTruthy();
    });
  });

  describe("revoke", () => {
    it("names the person in the confirmation", () => {
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          roles={[makeRole()]}
          revokeTargetUserId="user-1"
        />,
      );

      expect(screen.getByText(/^Casey Rivera will no longer be able to/)).toBeTruthy();
    });

    it("asks before revoking", () => {
      const onRequestRevoke = jest.fn();
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          roles={[makeRole()]}
          onRequestRevoke={onRequestRevoke}
        />,
      );

      fireEvent.press(screen.getByTestId("financial-controls-revoke-user-1"));
      expect(onRequestRevoke).toHaveBeenCalledWith("user-1");
    });

    it("shows the server's refusal in the dialog it came from", () => {
      render(
        <FinancialControlsView
          {...baseProps}
          viewerIsPrimaryAdmin
          roles={[makeRole()]}
          revokeTargetUserId="user-1"
          revokeError="Only the community's primary admin can change who has financial-controls access"
        />,
      );

      expect(screen.getByText(/Only the community's primary admin/)).toBeTruthy();
    });
  });

  it("explains the finance-access gate instead of erroring", () => {
    render(<FinancialControlsView {...baseProps} state="not-allowed" />);

    expect(screen.getByTestId("financial-controls-not-allowed")).toBeTruthy();
    expect(screen.getByText("You need financial-controls access")).toBeTruthy();
  });
});
