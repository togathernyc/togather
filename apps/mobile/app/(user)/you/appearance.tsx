/**
 * `/(user)/you/appearance` — the You tab's "Appearance" leaf.
 *
 * "How the app presents to me": theme (`AppearanceSection`) and time zone
 * (`TimezoneSection`), which the legacy `SettingsScreen` scattered on either
 * side of the profile form. Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { AppearanceSection } from "@features/settings/components/AppearanceSection";
import { TimezoneSection } from "@features/settings/components/TimezoneSection";

export default function YouAppearanceRoute() {
  return (
    <YouSubScreen title="Appearance">
      <AppearanceSection />
      <TimezoneSection />
    </YouSubScreen>
  );
}
