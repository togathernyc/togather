/**
 * `/(user)/you/app-info` — the You tab's "App info" leaf.
 *
 * Version / build / environment details (`AppInfoSection`), previously buried
 * second-to-last in the legacy `SettingsScreen` scroll. Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { AppInfoSection } from "@features/settings/components/AppInfoSection";

export default function YouAppInfoRoute() {
  return (
    <YouSubScreen title="App info">
      <AppInfoSection />
    </YouSubScreen>
  );
}
