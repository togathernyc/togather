/**
 * GivingHubScreen — data wrapper for the leader/admin group-giving hub
 * (ADR-032 §2 CTA, §4 approvals queue; group-fund cards phase). Resolves the
 * group's fund, the viewer's fund role, the fund overview (balance +
 * month-to-date), the card list, and the pending-expense queue, then hands
 * plain props to the presentational GivingHubView.
 */
import React, { useMemo, useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text, Share, Platform, ActionSheetIOS, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { ToastManager } from "@components/ui";
import { useMembersPage } from "@features/leader-tools/hooks/useMembersPage";
import { formatError } from "@/utils/error-handling";
import { GivingHubView, type GivingHubState } from "./GivingHubView";
import { SubmitReimbursementSheet } from "../member/SubmitReimbursementSheet";
import type { FundCard, GivingExpense, GivingHubActivityEntry, GivingHubBalanceSummary } from "./types";

export function GivingHubScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id || "";
  const { user, community } = useAuth();

  const { group, isLoadingGroup, handleBack } = useMembersPage(groupId);

  const [processingExpenseId, setProcessingExpenseId] = useState<string | null>(null);
  const [isEnablingGiving, setIsEnablingGiving] = useState(false);
  const [showReimbursement, setShowReimbursement] = useState(false);

  const givingContext = useAuthenticatedQuery(
    api.functions.finance.giving.getGivingContext,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const fundId = givingContext?.fundId as Id<"funds"> | undefined;

  const overview = useAuthenticatedQuery(
    api.functions.finance.giving.getFundOverview,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const myFundRole = useAuthenticatedQuery(
    api.functions.finance.roles.getMyFundRole,
    fundId ? { fundId } : "skip",
  );

  const expensesRaw = useAuthenticatedQuery(
    api.functions.finance.expenses.listExpenses,
    fundId ? { fundId, status: "pending" } : "skip",
  );

  const cardsRaw = useAuthenticatedQuery(
    api.functions.finance.cards.listFundCards,
    fundId ? { fundId } : "skip",
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

  const cards: FundCard[] = useMemo(() => (cardsRaw ?? []).map(toFundCard), [cardsRaw]);

  const balance: GivingHubBalanceSummary | undefined = useMemo(() => {
    if (!overview) return undefined;
    return {
      fundName: overview.fund.name,
      balanceCents: overview.balanceCents,
      monthDonationsCents: overview.monthToDate.donationsCents,
      monthDonationCount: overview.monthToDate.donationCount,
      monthSpentCents: overview.monthToDate.spentCents,
    };
  }, [overview]);

  const activity: GivingHubActivityEntry[] | undefined = useMemo(() => {
    if (!overview) return undefined;
    return overview.activity.map((entry: any) => ({
      id: String(entry.id),
      kind: entry.kind,
      amountCents: entry.amountCents,
      direction: entry.direction,
      createdAt: entry.createdAt,
      donorName: entry.donorName ?? null,
    }));
  }, [overview]);

  const canApprove =
    myFundRole?.role === "manager" || myFundRole?.role === "finance_admin" || isCommunityAdmin;

  const canManageCards = !!(
    myFundRole?.role === "finance_admin" ||
    myFundRole?.isGroupLeader ||
    myFundRole?.isCommunityAdmin ||
    user?.is_admin
  );

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

  const handleShareFund = async () => {
    if (!group?.shortId) return;
    const groupUrl = DOMAIN_CONFIG.groupShareUrl(group.shortId);
    const groupName = group?.name || "Group";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Cancel", "Copy Link", "Share"], cancelButtonIndex: 0 },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(groupUrl);
            Alert.alert("Link Copied", "Group link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({ message: `${groupName}\n${groupUrl}`, url: groupUrl });
          }
        },
      );
    } else {
      await Share.share({ message: `${groupName}\n${groupUrl}` });
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
        givingLive={!!givingContext?.givingLive}
        balance={balance}
        cards={cards}
        isLoadingCards={fundId != null && cardsRaw === undefined}
        canManageCards={canManageCards}
        expenses={expenses}
        isLoadingExpenses={fundId != null && expensesRaw === undefined}
        canApprove={!!canApprove}
        currentUserId={user?.id ?? null}
        processingExpenseId={processingExpenseId}
        onApprove={handleApprove}
        onDeny={handleDeny}
        activity={activity}
        onEnableGiving={handleEnableGiving}
        isEnablingGiving={isEnablingGiving}
        onViewRoles={() => router.push(`/(user)/leader-tools/${groupId}/giving/roles`)}
        onGivePress={() => router.push(`/groups/${groupId}/give` as any)}
        onReimbursePress={() => setShowReimbursement(true)}
        onCreateCardPress={() => router.push(`/(user)/leader-tools/${groupId}/giving/cards/new` as any)}
        onSharePress={group?.shortId ? handleShareFund : undefined}
        onViewCard={(cardId) => router.push(`/(user)/leader-tools/${groupId}/giving/cards/${cardId}` as any)}
        onViewAllActivity={() => router.push(`/groups/${groupId}/fund` as any)}
      />

      {fundId && (
        <SubmitReimbursementSheet
          visible={showReimbursement}
          fundId={fundId}
          onClose={() => setShowReimbursement(false)}
        />
      )}
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

function toFundCard(raw: any): FundCard {
  return {
    id: String(raw.id),
    name: raw.name,
    holderUserId: String(raw.holderUserId),
    holderName: raw.holderName,
    last4: raw.last4,
    status: raw.status,
    spendLimitCents: raw.spendLimitCents ?? null,
    limitPeriod: raw.limitPeriod ?? null,
    createdAt: raw.createdAt,
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
