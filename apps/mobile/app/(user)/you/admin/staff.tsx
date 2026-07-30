/**
 * `/(user)/you/admin/staff` — the You tab's "Staff dashboard" leaf.
 *
 * `SuperAdminDashboardContent`, i.e. the legacy `AdminScreen`'s "Dashboard"
 * segment. Gated on the internal-staff bit ALONE
 * (`useYouAdminAccess().showStaffDashboard` = `is_staff || is_superuser`), which
 * is precisely when `AdminScreen` offers the Dashboard tab — including the
 * no-community and non-admin staff cases, where Dashboard is the *only* tab it
 * shows. `scroll={false}`: the content is itself a `flex: 1` ScrollView.
 * Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { useYouAdminAccess } from "@features/profile/hooks/useYouAdminAccess";
import { SuperAdminDashboardContent } from "@features/admin/components/SuperAdminDashboardContent";

export default function YouAdminStaffRoute() {
  const { ready, showStaffDashboard } = useYouAdminAccess();
  return (
    <YouSubScreen
      title="Staff dashboard"
      scroll={false}
      gateReady={ready}
      allowed={showStaffDashboard}
    >
      <SuperAdminDashboardContent />
    </YouSubScreen>
  );
}
