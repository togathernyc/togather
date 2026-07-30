/**
 * GivingHubScreen — data wrapper for the leader/admin group-giving hub
 * (ADR-032 §2 CTA, §4 approvals queue). Resolves the group's fund, the
 * viewer's fund role, and the expense queue, then hands plain props to the
 * presentational GivingHubView.
 */
import React, { useMemo, useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { ToastManager } from "@components/ui";
import { useMembersPage } from "@features/leader-tools/hooks/useMembersPage";
import { formatError } from "@/utils/error-handling";
import { GivingHubView, type GivingHubState, type GivingHubTab } from "./GivingHubView";
import type { GivingExpense } from "./types";

export function GivingHubScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id || "";
  const { user, community } = useAuth();

  const { group, isLoadingGroup, handleBack } = useMembersPage(groupId);

  const [tab, setTab] = useState<GivingHubTab>("pending");
  const [processingExpenseId, setProcessingExpenseId] = useState<string | null>(null);
  const [isEnablingGiving, setIsEnablingGiving] = useState(false);

  const givingContext = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const fundId = givingContext?.fundId as Id<"funds"> | undefined;

  const myFundRole = useAuthenticatedQuery(
    api.functions.finance.roles.getMyFundRole,
    fundId ? { fundId } : "skip",
  );

  const statusFilter = tab === "all" ? undefined : tab;
  const expensesRaw = useAuthenticatedQuery(
    api.functions.finance.expenses.listExpenses,
    fundId ? { fundId, status: statusFilter } : "skip",
  );

  const approveExpense = useAuthenticatedMutation(api.functions.finance.expenses.approveExpense);
  const denyExpense = useAuthenticatedMutation(api.functions.finance.expenses.denyExpense);
  const enableGroupGiving = useAuthenticatedMutation(api.functions.finance.onboarding.enableGroupGiving);

  const isCommunityAdmin = !!(user?.is_admin || myFundRole?.isCommunityAdmin);

  const state: GivingHubState = useMemo(() => {
    if (isLoadingGroup || givingContext === undefined) return "loading";
    if (!givingContext) return isCommunityAdmin ? "no-fund-admin" : "no-fund-member";
    return "ready";
  }, [isLoadingGroup, givingContext, isCommunityAdmin]);

  const expenses: GivingExpense[] = useMemo(
    () => (expensesRaw ?? []).map(toGivingExpense),
    [expensesRaw],
  );

  const canApprove =
    myFundRole?.role === "manager" || myFundRole?.role === "finance_admin" || isCommunityAdmin;

  const handleApprove = async (expenseId: string) => {
    if (processingExpenseId) return;
    setProcessingExpenseId(expenseId);
    try {
      const result = await approveExpense({ expenseId: expenseId as Id<"expenses"> });
      ToastManager.success(
        result.status === "pending"
          ? "Approved — 1 of 2 approvals recorded"
          : "Expense approved",
      );
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to approve expense"));
    } finally {
      setProcessingExpenseId(null);
    }
  };

  const handleDeny = async (expenseId: string, reason: string) => {
    if (processingExpenseId) return;
    setProcessingExpenseId(expenseId);
    try {
      await denyExpense({ expenseId: expenseId as Id<"expenses">, reason });
      ToastManager.success("Expense denied");
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to deny expense"));
    } finally {
      setProcessingExpenseId(null);
    }
  };

  const handleEnableGiving = async () => {
    if (isEnablingGiving || !community?.id || !groupId) return;
    setIsEnablingGiving(true);
    try {
      await enableGroupGiving({
        communityId: community.id as Id<"communities">,
        groupId: groupId as Id<"groups">,
      });
      ToastManager.success("Giving enabled for this group");
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to enable giving"));
    } finally {
      setIsEnablingGiving(false);
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Giving</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {group?.name || "Group"}
          </Text>
        </View>
      </View>

      <GivingHubView
        state={state}
        groupName={group?.name || "this group"}
        tab={tab}
        onTabChange={setTab}
        expenses={expenses}
        isLoadingExpenses={fundId != null && expensesRaw === undefined}
        canApprove={!!canApprove}
        currentUserId={user?.id ?? null}
        processingExpenseId={processingExpenseId}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onEnableGiving={handleEnableGiving}
        isEnablingGiving={isEnablingGiving}
        onViewRoles={() => router.push(`/(user)/leader-tools/${groupId}/giving/roles`)}
      />
    </>
  );
}

function toGivingExpense(raw: any): GivingExpense {
  return {
    id: String(raw.id),
    amountCents: raw.amountCents,
    kind: raw.kind,
    description: raw.description,
    status: raw.status,
    receiptUrl: raw.receiptUrl ?? null,
    approverId: raw.approverId ?? null,
    secondApproverId: raw.secondApproverId ?? null,
    increaseTransferId: raw.increaseTransferId ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    submitter: {
      id: String(raw.submitter?.id ?? raw.submitterId ?? ""),
      firstName: raw.submitter?.firstName ?? raw.submitter?.first_name ?? null,
      lastName: raw.submitter?.lastName ?? raw.submitter?.last_name ?? null,
      displayName: raw.submitter?.displayName ?? null,
      profileImage: raw.submitter?.profileImage ?? raw.submitter?.profile_photo ?? null,
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
