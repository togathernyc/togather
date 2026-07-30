/**
 * FundRolesScreen — data wrapper for the fund-role roster + grant/revoke
 * flow (ADR-032 §4). Resolves the group's fund, the active roles, and the
 * viewer's own permission before handing plain props to FundRolesView.
 */
import React, { useMemo, useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { ToastManager, type CommunityMember } from "@components/ui";
import { useMembersPage } from "@features/leader-tools/hooks/useMembersPage";
import { formatError } from "@/utils/error-handling";
import { FundRolesView } from "./FundRolesView";
import type { FundRole, FundRoleRow } from "./types";

export function FundRolesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id || "";
  const { user } = useAuth();

  const { group, handleBack } = useMembersPage(groupId);

  const givingContext = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  const fundId = givingContext?.fundId as Id<"funds"> | undefined;

  const myFundRole = useAuthenticatedQuery(
    api.functions.finance.roles.getMyFundRole,
    fundId ? { fundId } : "skip",
  );

  const rolesRaw = useAuthenticatedQuery(
    api.functions.finance.roles.listFundRoles,
    fundId ? { fundId } : "skip",
  );

  const grantFundRole = useAuthenticatedMutation(api.functions.finance.roles.grantFundRole);
  const revokeFundRole = useAuthenticatedMutation(api.functions.finance.roles.revokeFundRole);

  const [isGrantSheetOpen, setIsGrantSheetOpen] = useState(false);
  const [pendingGrantee, setPendingGrantee] = useState<CommunityMember | null>(null);
  const [pendingRole, setPendingRole] = useState<FundRole>("cardholder");
  const [isGranting, setIsGranting] = useState(false);
  const [revokeTargetRoleId, setRevokeTargetRoleId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const canManageRoles = !!(
    myFundRole?.role === "finance_admin" ||
    myFundRole?.isGroupLeader ||
    myFundRole?.isCommunityAdmin ||
    user?.is_admin
  );

  const roles: FundRoleRow[] = useMemo(
    () => (rolesRaw ?? []).filter((r: any) => r.isActive).map(toFundRoleRow),
    [rolesRaw],
  );

  const closeGrantSheet = () => {
    setIsGrantSheetOpen(false);
    setPendingGrantee(null);
    setPendingRole("cardholder");
  };

  const handleConfirmGrant = async () => {
    if (!pendingGrantee || !fundId || isGranting) return;
    setIsGranting(true);
    try {
      await grantFundRole({
        fundId,
        userId: String(pendingGrantee.user_id) as Id<"users">,
        role: pendingRole,
      });
      ToastManager.success("Role granted");
      closeGrantSheet();
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to grant role"));
    } finally {
      setIsGranting(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTargetRoleId || !fundId || isRevoking) return;
    const target = roles.find((r) => r.id === revokeTargetRoleId);
    if (!target) {
      setRevokeTargetRoleId(null);
      return;
    }
    setIsRevoking(true);
    try {
      await revokeFundRole({ fundId, userId: target.userId as Id<"users"> });
      ToastManager.success("Role revoked");
      setRevokeTargetRoleId(null);
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to revoke role"));
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <>
      <DragHandle />
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack} testID="back-button">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Finance roles</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {group?.name || "Group"}
          </Text>
        </View>
      </View>

      <FundRolesView
        groupId={groupId}
        roles={roles}
        isLoadingRoles={fundId != null && rolesRaw === undefined}
        canManageRoles={canManageRoles}
        isGrantSheetOpen={isGrantSheetOpen}
        onOpenGrantSheet={() => setIsGrantSheetOpen(true)}
        onCloseGrantSheet={closeGrantSheet}
        pendingGrantee={pendingGrantee}
        onSelectGrantee={setPendingGrantee}
        pendingRole={pendingRole}
        onChangePendingRole={setPendingRole}
        onConfirmGrant={handleConfirmGrant}
        isGranting={isGranting}
        revokeTargetRoleId={revokeTargetRoleId}
        onRequestRevoke={setRevokeTargetRoleId}
        onCancelRevoke={() => setRevokeTargetRoleId(null)}
        onConfirmRevoke={handleConfirmRevoke}
        isRevoking={isRevoking}
      />
    </>
  );
}

function toFundRoleRow(raw: any): FundRoleRow {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    role: raw.role,
    grantedBy: String(raw.grantedBy),
    grantedAt: raw.grantedAt,
    revokedAt: raw.revokedAt ?? null,
    isActive: raw.isActive,
    user: {
      id: String(raw.user?.id ?? raw.userId),
      firstName: raw.user?.firstName ?? null,
      lastName: raw.user?.lastName ?? null,
      displayName: raw.user?.displayName ?? null,
      profileImage: raw.user?.profileImage ?? null,
    },
  };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
});
