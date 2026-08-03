/**
 * GivingHubScreen — data wrapper for the leader/admin "Fund settings" hub
 * (ADR-032 §2 CTA, §4 approvals queue; group-fund cards phase). Resolves the
 * group's fund, the viewer's fund role, the fund overview (balance), the card
 * list, and the pending-expense queue, then hands plain props to the
 * presentational GivingHubView.
 *
 * WhatsApp-shell restyle: this wrapper owns the screen chrome — the
 * `bg.grouped` canvas with a top safe-area inset and a `WaSubScreenHeader`
 * titled "Fund settings" (the `GroupInfoScreen` pattern), replacing the
 * bespoke "Giving" bar this screen used to draw. The entry points that route
 * here (e.g. Group info's "Leader tools › Giving" row) keep their own labels.
 */
import React, { useMemo, useState } from "react";
import { View, StyleSheet, Share, Platform, ActionSheetIOS, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { ToastManager } from "@components/ui";
import { WaSubScreenHeader } from "@components/wa";
import { useMembersPage } from "@features/leader-tools/hooks/useMembersPage";
import { formatError } from "@/utils/error-handling";
import { GivingHubView, type GivingHubState } from "./GivingHubView";
import type { FundCard, GivingExpense, GivingHubBalanceSummary } from "./types";

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

  // ADR-033: COMMUNITY-WIDE finance surfaces key off financial-controls
  // access (primary admin or an explicit grant), no longer plain community
  // admin.
  //
  // `user?.is_admin` is deliberately NOT OR'd in here. It is not a superuser
  // flag — AuthProvider sets it from the active community membership's
  // `isAdmin`, so it is exactly the plain-community-admin signal ADR-033
  // removes from these surfaces. Including it would re-admit that whole
  // population client-side and show them the "Enable Giving" CTA below, which
  // can now only throw against `enableGroupGiving`'s new gate — the
  // affordance-that-only-errors trap cards.ts calls out. (It is also the
  // wrong community: `is_admin` is scoped to the viewer's ACTIVE community,
  // while `myFundRole` is computed server-side for the FUND's community.)
  const canManageCommunityFinance = !!myFundRole?.canManageCommunityFinance;

  const state: GivingHubState = useMemo(() => {
    if (isLoadingGroup || givingContext === undefined) return "loading";
    if (!givingContext)
      return canManageCommunityFinance ? "no-fund-admin" : "no-fund-member";
    return "ready";
  }, [isLoadingGroup, givingContext, canManageCommunityFinance]);

  const expenses: GivingExpense[] = useMemo(
    () => (expensesRaw ?? []).map(toGivingExpense),
    [expensesRaw],
  );

  const cards: FundCard[] = useMemo(
    () => (cardsRaw?.cards ?? []).map(toFundCard),
    [cardsRaw],
  );

  const balance: GivingHubBalanceSummary | undefined = useMemo(() => {
    if (!overview) return undefined;
    return {
      fundName: overview.fund.name,
      balanceCents: overview.balanceCents,
      monthDonationsCents: overview.monthToDate.donationsCents,
      monthDonationCount: overview.monthToDate.donationCount,
      monthSpentCents: overview.monthToDate.spentCents,
      monthFeesCents: overview.monthToDate.feesCents ?? 0,
    };
  }, [overview]);

  // FUND-scoped, so it keeps the community-admin fallback ADR-033 explicitly
  // did NOT tighten: `approveExpense` still runs through `requireFundRole`,
  // whose `resolveEffectiveRole` resolves a community admin to finance_admin.
  // Dropping `user?.is_admin` here would make the UI stricter than the server
  // and hide buttons that would have worked.
  const canApprove =
    myFundRole?.role === "manager" ||
    myFundRole?.role === "finance_admin" ||
    canManageCommunityFinance ||
    !!user?.is_admin;

  // Mirrors createFundCard's own gate (finance_admin, incl. the
  // community-admin override) — a group leader without a finance role can
  // view the card list but must not be shown an affordance that can only
  // error on submit. Comes straight from listFundCards, not derived here.
  const canManageCards = !!cardsRaw?.viewerCanManageCards;

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
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
        ]}
      >
        {/* Floating back circle + centered 17pt title over the grouped-gray
            canvas — no bar fill, no hairline (WA-VISUAL-DELTAS.md S1.1). */}
        <WaSubScreenHeader title="Fund settings" onBack={handleBack} />

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
          onEnableGiving={handleEnableGiving}
          isEnablingGiving={isEnablingGiving}
          onViewRoles={() => router.push(`/(user)/leader-tools/${groupId}/giving/roles`)}
          onCreateCardPress={() => router.push(`/(user)/leader-tools/${groupId}/giving/cards/new` as any)}
          onSharePress={group?.shortId ? handleShareFund : undefined}
          onViewCard={(cardId) => router.push(`/(user)/leader-tools/${groupId}/giving/cards/${cardId}` as any)}
          onViewAllActivity={() => router.push(`/groups/${groupId}/fund` as any)}
        />
      </View>
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
  screen: {
    flex: 1,
  },
});
