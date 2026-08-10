/**
 * `/(user)/you/account` — the You tab's "Account" leaf.
 *
 * Profile info (`SettingsForm`) with the account-deletion danger zone
 * (`DeleteAccountSection`) pinned to the bottom, both lifted verbatim out of the
 * legacy `SettingsScreen`'s flat 10-section scroll. Flag-on only; flag-off users
 * still get the whole legacy screen via `ProfileMenu`.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { SettingsForm } from "@features/settings/components/SettingsForm";
import { DeleteAccountSection } from "@features/settings/components/DeleteAccountSection";

export default function YouAccountRoute() {
  return (
    <YouSubScreen title="Account">
      <SettingsForm />
      <DeleteAccountSection />
    </YouSubScreen>
  );
}
