/**
 * FundRolesView — presentational fund-role roster + grant/revoke flow
 * (ADR-032 §4 permissions). Plain props only, no Convex import of our own —
 * see FundRolesScreen.tsx for the data wrapper.
 *
 * Note for the mock-data render harness: this View renders the shared
 * `MemberSearch` component inside the grant-role `Modal`, and RN's `Modal`
 * mounts its children into the tree even while `visible={false}` (it only
 * hides them natively) — so `MemberSearch` mounts on every render of this
 * View, not just when `isGrantSheetOpen` is true. `MemberSearch` calls
 * Convex hooks internally (`useMemberSearch`), so the harness needs either a
 * `ConvexProvider`/mocked `convex/react` + `@services/api/convex` in scope,
 * or to stub `@components/ui`'s `MemberSearch` export, before rendering this
 * View — plain mock *props* alone are not enough to avoid that dependency.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  Badge,
  Avatar,
  Button,
  EmptyState,
  Skeleton,
  ConfirmModal,
  MemberSearch,
  Select,
  type CommunityMember,
} from "@components/ui";
// See GivingHubView.tsx for why this is imported from the concrete file
// rather than the "@components/ui" barrel.
import { CustomModal as Modal } from "@components/ui/Modal";
import { FUND_ROLE_LABELS, GIVING_GUARDRAILS_NOTE, type FundRole, type FundRoleRow } from "./types";
import { financeDisplayName } from "./utils";

const ROLE_OPTIONS: { label: string; value: FundRole }[] = [
  { label: FUND_ROLE_LABELS.finance_admin, value: "finance_admin" },
  { label: FUND_ROLE_LABELS.manager, value: "manager" },
  { label: FUND_ROLE_LABELS.cardholder, value: "cardholder" },
];

export interface FundRolesViewProps {
  groupId: string;
  roles: FundRoleRow[];
  isLoadingRoles: boolean;
  /**
   * `canManageCommunityFinance` per `getMyFundRole` — and ONLY that, since
   * ADR-033 Phase 3 made granting and revoking a fund role a community act.
   * A group leader or the fund's own finance_admin still reads this roster;
   * neither can change it.
   */
  canManageRoles: boolean;
  isGrantSheetOpen: boolean;
  onOpenGrantSheet: () => void;
  onCloseGrantSheet: () => void;
  pendingGrantee: CommunityMember | null;
  onSelectGrantee: (member: CommunityMember | null) => void;
  pendingRole: FundRole;
  onChangePendingRole: (role: FundRole) => void;
  onConfirmGrant: () => void;
  isGranting: boolean;
  revokeTargetRoleId: string | null;
  onRequestRevoke: (roleId: string) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  isRevoking: boolean;
}

export function FundRolesView({
  groupId,
  roles,
  isLoadingRoles,
  canManageRoles,
  isGrantSheetOpen,
  onOpenGrantSheet,
  onCloseGrantSheet,
  pendingGrantee,
  onSelectGrantee,
  pendingRole,
  onChangePendingRole,
  onConfirmGrant,
  isGranting,
  revokeTargetRoleId,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  isRevoking,
}: FundRolesViewProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const revokeTarget = roles.find((r) => r.id === revokeTargetRoleId) ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.guardrailsNote, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} style={{ marginTop: 1 }} />
        <Text style={[styles.guardrailsText, { color: colors.textSecondary }]}>{GIVING_GUARDRAILS_NOTE}</Text>
      </View>

      {canManageRoles && (
        <TouchableOpacity
          style={[styles.grantButton, { backgroundColor: primaryColor }]}
          onPress={onOpenGrantSheet}
          testID="grant-role-button"
        >
          <Ionicons name="person-add-outline" size={18} color={colors.textInverse} />
          <Text style={[styles.grantButtonText, { color: colors.textInverse }]}>Grant a role</Text>
        </TouchableOpacity>
      )}

      {isLoadingRoles ? (
        <View style={styles.loadingPad}>
          <Skeleton width="100%" height={64} />
          <Skeleton width="100%" height={64} style={{ marginTop: 12 }} />
        </View>
      ) : roles.length === 0 ? (
        <EmptyState
          icon="shield-outline"
          title="No finance roles yet"
          message={
            canManageRoles
              ? "Grant Finance admin, Manager, or Cardholder roles to trusted members."
              : // Names who can actually do it. "Ask a group leader" was true
                // before ADR-033 Phase 3 and is now a dead end — a leader who
                // was asked would find the same screen with no buttons on it.
                "Ask someone with your community's financial controls to grant finance roles."
          }
        />
      ) : (
        <View style={styles.list}>
          {roles.map((roleRow) => (
            <View
              key={roleRow.id}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID={`fund-role-row-${roleRow.id}`}
            >
              <Avatar name={financeDisplayName(roleRow.user)} imageUrl={roleRow.user.profileImage} size={40} />
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                  {financeDisplayName(roleRow.user)}
                </Text>
                <Badge variant={badgeVariantForRole(roleRow.role)} size="small" style={{ marginTop: 4 }}>
                  {FUND_ROLE_LABELS[roleRow.role]}
                </Badge>
              </View>
              {canManageRoles && (
                <TouchableOpacity
                  onPress={() => onRequestRevoke(roleRow.id)}
                  style={styles.revokeButton}
                  accessibilityRole="button"
                  testID={`revoke-role-${roleRow.id}`}
                >
                  <Text style={[styles.revokeButtonText, { color: colors.destructive }]}>Revoke</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      <Modal visible={isGrantSheetOpen} onClose={onCloseGrantSheet} title="Grant a finance role">
        <View>
          {pendingGrantee ? (
            <View style={[styles.selectedMemberRow, { borderColor: colors.border }]}>
              <Avatar
                name={`${pendingGrantee.first_name} ${pendingGrantee.last_name}`}
                imageUrl={pendingGrantee.profile_photo}
                size={36}
              />
              <Text style={[styles.selectedMemberName, { color: colors.text }]}>
                {pendingGrantee.first_name} {pendingGrantee.last_name}
              </Text>
              <TouchableOpacity onPress={() => onSelectGrantee(null)}>
                <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : (
            <MemberSearch
              groupId={groupId}
              onSelect={onSelectGrantee}
              placeholder="Search group members…"
              maxResults={5}
              testID="grant-role-member-search"
            />
          )}

          <View style={{ marginTop: 16 }}>
            <Select
              label="Role"
              value={pendingRole}
              options={ROLE_OPTIONS}
              onSelect={(value) => onChangePendingRole(value as FundRole)}
            />
          </View>

          <Button
            variant="primary"
            onPress={onConfirmGrant}
            loading={isGranting}
            disabled={!pendingGrantee}
            style={{ marginTop: 8 }}
          >
            Grant role
          </Button>
        </View>
      </Modal>

      <ConfirmModal
        visible={!!revokeTargetRoleId}
        title="Revoke role"
        message={
          revokeTarget
            ? `Remove ${FUND_ROLE_LABELS[revokeTarget.role]} from ${financeDisplayName(revokeTarget.user)}?`
            : "Remove this role?"
        }
        confirmText="Revoke"
        destructive
        isLoading={isRevoking}
        onConfirm={onConfirmRevoke}
        onCancel={onCancelRevoke}
      />
    </View>
  );
}

function badgeVariantForRole(role: FundRole): "primary" | "info" | "secondary" {
  if (role === "finance_admin") return "primary";
  if (role === "manager") return "info";
  return "secondary";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  guardrailsNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  guardrailsText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  grantButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  grantButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  loadingPad: {
    marginTop: 4,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
  },
  revokeButton: {
    padding: 6,
  },
  revokeButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  selectedMemberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  selectedMemberName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
});
