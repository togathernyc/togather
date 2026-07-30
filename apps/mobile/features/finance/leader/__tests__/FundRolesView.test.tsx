import React from "react";
import { render, screen } from "@testing-library/react-native";
import { FundRolesView } from "../FundRolesView";
import type { FundRoleRow } from "../types";

// jest.setup.js globally mocks convex/react + @services/api/convex, so the
// shared MemberSearch component (rendered inside this View's grant-role
// Modal — RN's Modal mounts children even while closed) resolves safely
// without a real ConvexProvider. See FundRolesView.tsx's file header.

function makeRole(overrides: Partial<FundRoleRow> = {}): FundRoleRow {
  return {
    id: "role-1",
    userId: "user-1",
    role: "manager",
    grantedBy: "leader-1",
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

const baseProps = {
  groupId: "group-1",
  isLoadingRoles: false,
  isGrantSheetOpen: false,
  onOpenGrantSheet: jest.fn(),
  onCloseGrantSheet: jest.fn(),
  pendingGrantee: null,
  onSelectGrantee: jest.fn(),
  pendingRole: "cardholder" as const,
  onChangePendingRole: jest.fn(),
  onConfirmGrant: jest.fn(),
  isGranting: false,
  revokeTargetRoleId: null,
  onRequestRevoke: jest.fn(),
  onCancelRevoke: jest.fn(),
  onConfirmRevoke: jest.fn(),
  isRevoking: false,
};

describe("FundRolesView", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders a role badge per row with the ADR-032 labels", () => {
    const roles = [
      makeRole({ id: "r1", role: "finance_admin", user: { ...makeRole().user, id: "u1", displayName: "Finn Admin" } }),
      makeRole({ id: "r2", role: "manager", user: { ...makeRole().user, id: "u2", displayName: "Mia Manager" } }),
      makeRole({ id: "r3", role: "cardholder", user: { ...makeRole().user, id: "u3", displayName: "Carl Cardholder" } }),
    ];
    render(<FundRolesView {...baseProps} roles={roles} canManageRoles={true} />);

    expect(screen.getByText("Finance admin")).toBeTruthy();
    expect(screen.getByText("Manager")).toBeTruthy();
    expect(screen.getByText("Cardholder")).toBeTruthy();
  });

  it("hides grant/revoke controls for a viewer who is only a manager", () => {
    const roles = [makeRole()];
    render(<FundRolesView {...baseProps} roles={roles} canManageRoles={false} />);

    expect(screen.queryByTestId("grant-role-button")).toBeNull();
    expect(screen.queryByTestId(`revoke-role-${roles[0].id}`)).toBeNull();
  });

  it("shows grant/revoke controls for a finance admin", () => {
    const roles = [makeRole()];
    render(<FundRolesView {...baseProps} roles={roles} canManageRoles={true} />);

    expect(screen.getByTestId("grant-role-button")).toBeTruthy();
    expect(screen.getByTestId(`revoke-role-${roles[0].id}`)).toBeTruthy();
  });

  it("shows the guardrails note", () => {
    render(<FundRolesView {...baseProps} roles={[]} canManageRoles={true} />);

    expect(
      screen.getByText("Approvals over $200 need a second approver. You can't approve your own requests.")
    ).toBeTruthy();
  });
});
