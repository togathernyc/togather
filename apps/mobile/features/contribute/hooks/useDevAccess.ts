/**
 * useDevAccess — wraps devAssistant/maintainers.myAccess.
 *
 * Contributors and maintainers are the same thing in Phase 1: anyone the
 * dev-assistant maintainer check admits (superuser/staff implicit, or the
 * dev_maintainer platform role) can use the contribute dashboard.
 */
import { api, useAuthenticatedQuery } from "@services/api/convex";
import type { DevAccess } from "../types";

export interface UseDevAccessResult {
  access: DevAccess | undefined;
  /** True once the query has resolved and the user may use the dashboard. */
  hasAccess: boolean;
  isLoading: boolean;
}

export function useDevAccess(): UseDevAccessResult {
  const access = useAuthenticatedQuery(
    api.functions.devAssistant.maintainers.myAccess,
    {},
  );

  return {
    access,
    hasAccess: access?.canUseAssistant === true,
    isLoading: access === undefined,
  };
}
