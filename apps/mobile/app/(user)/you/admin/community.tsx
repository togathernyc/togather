/**
 * `/(user)/you/admin/community` — the You tab's "Community settings" leaf.
 *
 * `SettingsContent`, i.e. the legacy `AdminScreen`'s "Settings" segment
 * (community branding, features, group types — not the user's own settings,
 * which live under `/(user)/you/account`). Gated by `showCommunityAdmin`;
 * `scroll={false}` because the content owns its own `flex: 1` ScrollView.
 * Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { useYouAdminAccess } from "@features/profile/hooks/useYouAdminAccess";
import { SettingsContent } from "@features/admin/components/SettingsContent";

export default function YouAdminCommunityRoute() {
  const { ready, showCommunityAdmin } = useYouAdminAccess();
  return (
    <YouSubScreen
      title="Community settings"
      scroll={false}
      gateReady={ready}
      allowed={showCommunityAdmin}
    >
      <SettingsContent />
    </YouSubScreen>
  );
}
