/**
 * FundScreen — data wrapper for the member-facing group-giving transparency
 * screen (ADR-032 §3/§7 Phase 1). Reached from the "Giving" tile on
 * GroupDetailScreen (app/groups/[group_id]/fund.tsx).
 *
 * All Convex/router wiring lives here; the actual UI is
 * `FundScreenView`, kept prop-only so a verification harness can render it
 * with mock data (no Convex imports there).
 */
import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { FundScreenView } from "./FundScreenView";
import { SubmitReimbursementSheet } from "./SubmitReimbursementSheet";

export function FundScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const groupId = params.group_id;
  const router = useRouter();
  const [showReimbursement, setShowReimbursement] = useState(false);

  const overview = useAuthenticatedQuery(
    api.functions.finance.giving.getFundOverview,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const fundId = overview?.fund?.id as Id<"funds"> | undefined;

  const myExpenses = useAuthenticatedQuery(
    api.functions.finance.expenses.listMyExpenses,
    fundId ? { fundId } : "skip",
  );

  // The viewer's own monthly gift to this fund, if any. Donor-scoped by
  // construction on the server (`by_donor_fund`), so this is never anyone
  // else's giving — and it returns `null` for a `pending`/canceled row, which
  // is exactly when the dashboard box should not exist.
  const recurring = useAuthenticatedQuery(
    api.functions.finance.giving.getRecurringForFund,
    fundId ? { fundId } : "skip",
  );

  // Manager+ (or leader/community admin) viewers get the "Fund settings" cell
  // linking to the leader giving hub (approvals + roles) — the only nav entry
  // point into it besides deep links, since the per-group toolbar config is
  // out of scope. Passing `onManagePress` IS the gate: `FundScreenView`
  // renders the whole "Fund" card only when it's set.
  const myRole = useAuthenticatedQuery(
    api.functions.finance.roles.getMyFundRole,
    fundId ? { fundId } : "skip",
  );
  const canManage =
    myRole?.role === "manager" ||
    myRole?.role === "finance_admin" ||
    myRole?.isGroupLeader === true ||
    myRole?.isCommunityAdmin === true;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (groupId) {
      router.push(`/groups/${groupId}`);
    }
  };

  const handleGivePress = () => {
    if (!groupId) return;
    router.push(`/groups/${groupId}/give` as any);
  };

  return (
    <>
      <FundScreenView
        overview={overview}
        myExpenses={myExpenses}
        onBack={handleBack}
        onGivePress={handleGivePress}
        onGetReimbursedPress={() => setShowReimbursement(true)}
        recurring={recurring}
        onManageRecurringPress={
          groupId
            ? () => router.push(`/groups/${groupId}/monthly-giving` as any)
            : undefined
        }
        onManagePress={
          canManage && groupId
            ? () =>
                router.push(`/(user)/leader-tools/${groupId}/giving` as any)
            : undefined
        }
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
