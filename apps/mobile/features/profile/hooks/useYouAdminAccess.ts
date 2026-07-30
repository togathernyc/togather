/**
 * useYouAdminAccess — the single predicate behind the You tab's "Admin" group
 * and the `/(user)/you/admin/*` routes it links to.
 *
 * The WhatsApp-shell You tab replaces the old single "Admin tools" row (which
 * pushed the whole segmented `AdminScreen`) with one row per admin surface. To
 * keep the two entry points honest, the row visibility here is derived from
 * exactly the same facts `AdminScreen` uses to decide which segmented tabs it
 * shows — no new permission logic:
 *
 *   AdminScreen tab logic                          | equivalent here
 *   ---------------------------------------------- | --------------------------
 *   internal && !isAdmin        → [Dashboard]      | showStaffDashboard only
 *   internal && !hasCommunity   → [Dashboard]      | showStaffDashboard only
 *   internal                    → 4 tabs + Dash    | both flags true
 *   (else, i.e. isAdmin+community) → 4 tabs        | showCommunityAdmin only
 *   !internal && !hasCommunity  → "No Community"   | neither → group hidden
 *
 * `showCommunityAdmin` is therefore `isAdmin && hasCommunity`, and
 * `showStaffDashboard` is the internal-user bit. Their OR reproduces the Admin
 * tab's own `href` gate in `(tabs)/_layout.tsx`
 * (`(isAdmin && hasCommunity) || isInternalUser`), which is what `YouScreen`
 * used to gate the single row on.
 *
 * `ready` is false while `AuthProvider` is still hydrating, so route guards can
 * wait instead of bouncing an admin who simply hasn't loaded yet.
 */
import { useAuth } from "@providers/AuthProvider";

export interface YouAdminAccess {
  /** False while AuthProvider is still loading the user/community. */
  ready: boolean;
  /** Join requests · Members · Attendance · Community settings. */
  showCommunityAdmin: boolean;
  /** Togather-internal staff dashboard. */
  showStaffDashboard: boolean;
  /** Whether the Admin group should render at all. */
  showAdminGroup: boolean;
}

export function useYouAdminAccess(): YouAdminAccess {
  const { user, community, isLoading } = useAuth();

  const isAdmin = user?.is_admin === true;
  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;
  const hasCommunity = !!community?.id;

  const showCommunityAdmin = isAdmin && hasCommunity;
  const showStaffDashboard = isInternalUser;

  return {
    ready: !isLoading,
    showCommunityAdmin,
    showStaffDashboard,
    showAdminGroup: showCommunityAdmin || showStaffDashboard,
  };
}
