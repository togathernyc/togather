/**
 * CommunityFinanceHomeScreen — data wrapper for `/finance-setup`, the
 * community's Finance home (ADR-032 §2, ADR-033 §5). Owns the screen chrome
 * and hands plain props to CommunityFinanceHomeView.
 *
 * IT ABSORBS THE ONBOARDING CHECKLIST rather than sitting beside it. While the
 * community's giving isn't live, this route still renders the checklist — the
 * setup flow is the only thing there is to do, and its own deep links
 * (`/finance-setup/intake`, Stripe's return URL) keep working untouched. The
 * moment it goes live the checklist has nothing left to say, so the home takes
 * over: before this split, a finished community landed on four ticked boxes
 * and a dead end.
 *
 * Same two-layer gate as CardProviderScreen and FinancialControlsScreen:
 * `user?.is_admin` decides whether the queries run at all, and
 * `CommunityFinanceAccessBoundary` catches the community-admin-without-a-grant
 * case that `getCommunityFinanceOverview` refuses. See CommunityFinanceAccess.tsx.
 */
import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { ToastManager } from "@components/ui";
import { WaSubScreenHeader } from "@components/wa";
import { formatError } from "@/utils/error-handling";
import {
  CommunityFinanceHomeView,
  COMMUNITY_FINANCE_HOME_DENIED_MESSAGE,
  type CommunityFinanceHomeState,
} from "./CommunityFinanceHomeView";
import {
  CommunityFinanceAccessBoundary,
  CommunityFinanceAccessDenied,
} from "./CommunityFinanceAccess";
import { FinanceOnboardingStatusContent } from "./FinanceOnboardingStatusScreen";
import type { CommunityFinanceOverview } from "./types";

export function CommunityFinanceHomeScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)" as any);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Finance" onBack={handleBack} />
      <CommunityFinanceAccessBoundary
        fallback={
          <CommunityFinanceAccessDenied
            message={COMMUNITY_FINANCE_HOME_DENIED_MESSAGE}
          />
        }
      >
        <CommunityFinanceHomeContent />
      </CommunityFinanceAccessBoundary>
    </View>
  );
}

/** Split from the screen so the boundary sits between the chrome and the query. */
function CommunityFinanceHomeContent() {
  const router = useRouter();
  const { user, community, isLoading: isAuthLoading } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;
  const isCommunityAdmin = user?.is_admin === true;

  const raw = useAuthenticatedQuery(
    api.functions.finance.giving.getCommunityFinanceOverview,
    communityId && isCommunityAdmin ? { communityId } : "skip",
  );

  const enableGroupGiving = useAuthenticatedMutation(
    api.functions.finance.onboarding.enableGroupGiving,
  );
  const [enablingGroupId, setEnablingGroupId] = useState<string | null>(null);

  const state: CommunityFinanceHomeState =
    !isAuthLoading && !isCommunityAdmin
      ? "not-allowed"
      : raw === undefined
        ? "loading"
        : "ready";

  const overview: CommunityFinanceOverview | undefined = raw
    ? toOverview(raw)
    : undefined;

  const handleEnableGiving = async (groupId: string) => {
    if (!communityId || enablingGroupId) return;
    setEnablingGroupId(groupId);
    try {
      await enableGroupGiving({
        communityId,
        groupId: groupId as Id<"groups">,
      });
      ToastManager.success("Giving enabled for this group");
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to enable giving"));
    } finally {
      setEnablingGroupId(null);
    }
  };

  // The checklist takeover. Deliberately AFTER the hooks above, never inside a
  // condition — and only once the query has answered, so a live community
  // doesn't flash the setup flow on every open.
  if (overview && overview.onboardingStatus !== "live") {
    return <FinanceOnboardingStatusContent />;
  }

  return (
    <CommunityFinanceHomeView
      state={state}
      overview={overview}
      onOpenFund={(groupId) =>
        router.push(`/(user)/leader-tools/${groupId}/giving` as any)
      }
      onEnableGiving={handleEnableGiving}
      enablingGroupId={enablingGroupId}
      onOpenCardProvider={() => router.push("/finance-setup/card-provider" as any)}
      onOpenFinancialControls={() =>
        router.push("/finance-setup/financial-controls" as any)
      }
      onOpenOrganizationDetails={() => router.push("/finance-setup/intake" as any)}
    />
  );
}

function toOverview(raw: any): CommunityFinanceOverview {
  return {
    onboardingStatus: raw.onboardingStatus ?? null,
    canEnableGiving: !!raw.canEnableGiving,
    provider: {
      name: raw.provider?.name ?? "none",
      connected: !!raw.provider?.connected,
      accountLabel: raw.provider?.accountLabel ?? null,
      status: raw.provider?.status ?? null,
    },
    totals: {
      balanceCents: raw.totals?.balanceCents ?? 0,
      monthDonatedCents: raw.totals?.monthDonatedCents ?? 0,
      monthSpentCents: raw.totals?.monthSpentCents ?? 0,
      cardCount: raw.totals?.cardCount ?? 0,
      fundCount: raw.totals?.fundCount ?? 0,
    },
    funds: (raw.funds ?? []).map((fund: any) => ({
      fundId: String(fund.fundId),
      groupId: fund.groupId ? String(fund.groupId) : null,
      groupName: fund.groupName ?? null,
      fundName: fund.fundName,
      type: fund.type,
      status: fund.status,
      balanceCents: fund.balanceCents,
      monthDonatedCents: fund.monthDonatedCents,
      monthSpentCents: fund.monthSpentCents,
      cardCount: fund.cardCount ?? 0,
    })),
    groupsWithoutFunds: (raw.groupsWithoutFunds ?? []).map((group: any) => ({
      groupId: String(group.groupId),
      groupName: group.groupName,
    })),
    financeGrantCount: raw.financeGrantCount ?? 0,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
