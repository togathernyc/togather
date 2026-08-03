/**
 * FinancialControlsScreen — data wrapper for "who can run this community's
 * money" (ADR-033 §5). Owns the screen chrome and hands plain props to
 * FinancialControlsView.
 *
 * Same two-layer gate as CardProviderScreen: `user?.is_admin` decides whether
 * the queries run at all, and `CommunityFinanceAccessBoundary` catches the
 * community-admin-without-a-grant case that `listCommunityFinanceRoles`
 * refuses. See CommunityFinanceAccess.tsx for why the boundary exists.
 *
 * The grant PICKER is `listGrantableFinanceAdmins`, not a member search: the
 * mutation refuses anyone who isn't already a community admin, so a general
 * search would make most taps end in an error the person can only fix on a
 * different screen.
 */
import React, { useMemo, useState } from "react";
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
import { errorMessage, formatError } from "@/utils/error-handling";
import {
  FinancialControlsView,
  FINANCIAL_CONTROLS_DENIED_MESSAGE,
  type FinancialControlsState,
} from "./FinancialControlsView";
import {
  CommunityFinanceAccessBoundary,
  CommunityFinanceAccessDenied,
} from "./CommunityFinanceAccess";
import { financeDisplayName } from "./utils";
import type { CommunityFinanceRoleRow, FinanceUserSummary } from "./types";

export function FinancialControlsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/finance-setup" as any);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      <WaSubScreenHeader title="Financial controls" onBack={handleBack} />
      <CommunityFinanceAccessBoundary
        fallback={
          <CommunityFinanceAccessDenied
            message={FINANCIAL_CONTROLS_DENIED_MESSAGE}
          />
        }
      >
        <FinancialControlsContent />
      </CommunityFinanceAccessBoundary>
    </View>
  );
}

/** Split out so the boundary sits between the chrome and the gated queries. */
function FinancialControlsContent() {
  const { user, community, isLoading: isAuthLoading } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;
  const isCommunityAdmin = user?.is_admin === true;
  const canQuery = !!communityId && isCommunityAdmin;

  const rosterRaw = useAuthenticatedQuery(
    api.functions.finance.communityRoles.listCommunityFinanceRoles,
    canQuery ? { communityId } : "skip",
  );

  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Only fetched while the picker is open: it's a second gated round-trip that
  // nobody reading the roster needs, and the roster is the screen's job.
  const grantableRaw = useAuthenticatedQuery(
    api.functions.finance.communityRoles.listGrantableFinanceAdmins,
    canQuery && isPickerOpen ? { communityId } : "skip",
  );

  const grantRole = useAuthenticatedMutation(
    api.functions.finance.communityRoles.grantCommunityFinanceRole,
  );
  const revokeRole = useAuthenticatedMutation(
    api.functions.finance.communityRoles.revokeCommunityFinanceRole,
  );

  const [isGranting, setIsGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [revokeTargetUserId, setRevokeTargetUserId] = useState<string | null>(
    null,
  );
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const state: FinancialControlsState =
    !isAuthLoading && !isCommunityAdmin
      ? "not-allowed"
      : rosterRaw === undefined
        ? "loading"
        : "ready";

  // Revoked grants are filtered out HERE rather than server-side: the query
  // returns both because the roster is the audit surface for the people it
  // governs, and this screen has decided (see FinancialControlsView's header)
  // that a dimmed "used to have access" row reads as access.
  const roles: CommunityFinanceRoleRow[] = useMemo(
    () =>
      (rosterRaw?.roles ?? []).filter((r: any) => r.isActive).map(toRoleRow),
    [rosterRaw],
  );

  const grantable: FinanceUserSummary[] = useMemo(
    () => (grantableRaw ?? []).map(toUserSummary),
    [grantableRaw],
  );

  const handleGrant = async (userId: string) => {
    if (!communityId || isGranting) return;
    setIsGranting(true);
    setGrantError(null);
    try {
      await grantRole({ communityId, userId: userId as Id<"users"> });
      const granted = grantable.find((candidate) => candidate.id === userId);
      ToastManager.success(
        `${financeDisplayName(granted)} now has financial controls`,
      );
      setIsPickerOpen(false);
    } catch (error) {
      setGrantError(
        errorMessage(
          error,
          formatError(
            error,
            "Couldn't give financial controls. Please try again.",
          ),
        ),
      );
    } finally {
      setIsGranting(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!communityId || !revokeTargetUserId || isRevoking) return;
    setIsRevoking(true);
    try {
      await revokeRole({
        communityId,
        userId: revokeTargetUserId as Id<"users">,
      });
      ToastManager.success("Financial controls removed");
      setRevokeTargetUserId(null);
      setRevokeError(null);
    } catch (error) {
      // Re-rendered into the open confirm dialog, same reasoning as the
      // card-provider disconnect guard: the refusal names who may do this
      // instead, and the person needs it in front of them.
      setRevokeError(
        errorMessage(
          error,
          formatError(
            error,
            "Couldn't remove financial controls. Please try again.",
          ),
        ),
      );
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <FinancialControlsView
      state={state}
      roles={roles}
      viewerIsPrimaryAdmin={!!rosterRaw?.viewerIsPrimaryAdmin}
      isPickerOpen={isPickerOpen}
      onOpenPicker={() => {
        setGrantError(null);
        setIsPickerOpen(true);
      }}
      onClosePicker={() => {
        setIsPickerOpen(false);
        setGrantError(null);
      }}
      grantable={grantable}
      isLoadingGrantable={isPickerOpen && grantableRaw === undefined}
      onGrant={handleGrant}
      isGranting={isGranting}
      grantError={grantError}
      revokeTargetUserId={revokeTargetUserId}
      onRequestRevoke={(userId) => {
        setRevokeError(null);
        setRevokeTargetUserId(userId);
      }}
      onCancelRevoke={() => {
        setRevokeTargetUserId(null);
        setRevokeError(null);
      }}
      onConfirmRevoke={handleConfirmRevoke}
      isRevoking={isRevoking}
      revokeError={revokeError}
    />
  );
}

function toRoleRow(raw: any): CommunityFinanceRoleRow {
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    grantedAt: raw.grantedAt,
    revokedAt: raw.revokedAt ?? null,
    isActive: !!raw.isActive,
    user: raw.user ? toUserSummary(raw.user) : null,
  };
}

function toUserSummary(raw: any): FinanceUserSummary {
  return {
    id: String(raw.id),
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,
    displayName: raw.displayName ?? null,
    profileImage: raw.profileImage ?? null,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
