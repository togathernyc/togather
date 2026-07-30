/**
 * `/(user)/you/notifications` — the You tab's "Notifications" leaf.
 *
 * Notification preferences ONLY. This is the row that used to open the entire
 * legacy `SettingsScreen` (profile form, theme, time zone, duplicated leader /
 * quick-link / contribute / blocked cards, app info, delete account) just to
 * reach these toggles. Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { NotificationPreferencesSection } from "@features/settings/components/NotificationPreferencesSection";

export default function YouNotificationsRoute() {
  return (
    <YouSubScreen title="Notifications">
      <NotificationPreferencesSection />
    </YouSubScreen>
  );
}
