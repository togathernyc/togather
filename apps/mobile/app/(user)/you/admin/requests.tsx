/**
 * `/(user)/you/admin/requests` — the You tab's "Join requests" leaf.
 *
 * `PendingRequestsContent`, i.e. the legacy `AdminScreen`'s "Requests" segment,
 * addressable on its own. Gated by `useYouAdminAccess().showCommunityAdmin` —
 * the same `isAdmin && hasCommunity` fact `AdminScreen` uses to decide whether
 * to show its four community-admin tabs. `scroll={false}`: the content owns its
 * own `flex: 1` ScrollView. Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { useYouAdminAccess } from "@features/profile/hooks/useYouAdminAccess";
import { PendingRequestsContent } from "@features/admin/components/PendingRequestsContent";

export default function YouAdminRequestsRoute() {
  const { ready, showCommunityAdmin } = useYouAdminAccess();
  return (
    <YouSubScreen title="Join requests" scroll={false} gateReady={ready} allowed={showCommunityAdmin}>
      <PendingRequestsContent />
    </YouSubScreen>
  );
}
