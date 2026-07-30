/**
 * `/(user)/you/admin/stats` — the You tab's "Attendance stats" leaf.
 *
 * `StatsContent`, i.e. the legacy `AdminScreen`'s "Stats" segment. Gated by
 * `showCommunityAdmin`; `scroll={false}` because the content owns its own
 * `flex: 1` ScrollView. Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { useYouAdminAccess } from "@features/profile/hooks/useYouAdminAccess";
import { StatsContent } from "@features/admin/components/StatsContent";

export default function YouAdminStatsRoute() {
  const { ready, showCommunityAdmin } = useYouAdminAccess();
  return (
    <YouSubScreen title="Attendance" scroll={false} gateReady={ready} allowed={showCommunityAdmin}>
      <StatsContent />
    </YouSubScreen>
  );
}
