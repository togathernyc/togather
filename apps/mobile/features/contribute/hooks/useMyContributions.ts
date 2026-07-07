/**
 * Conversation-list queries: the current user's contributions and (for
 * maintainers) everyone's. Newest first, each with a snippet of the latest
 * thread message.
 */
import { api, useAuthenticatedQuery } from "@services/api/convex";
import type { ContributionListItem } from "../types";

/**
 * useMyContributions — the current user's contributions.
 * Pass enabled=false to skip (e.g. until dev-dashboard access is confirmed —
 * the query throws a ConvexError for non-contributors, which would crash the
 * render).
 */
export function useMyContributions(enabled: boolean): {
  contributions: ContributionListItem[] | undefined;
  isLoading: boolean;
} {
  const contributions: ContributionListItem[] | undefined = useAuthenticatedQuery(
    api.functions.devAssistant.contributions.myContributions,
    enabled ? {} : "skip",
  );
  return { contributions, isLoading: contributions === undefined };
}

/**
 * useAllContributions — everyone's contributions (maintainer view).
 * Pass enabled=false to skip (e.g. while the "Mine" toggle is selected).
 */
export function useAllContributions(enabled: boolean): {
  contributions: ContributionListItem[] | undefined;
  isLoading: boolean;
} {
  const contributions: ContributionListItem[] | undefined = useAuthenticatedQuery(
    api.functions.devAssistant.contributions.listAll,
    enabled ? {} : "skip",
  );
  return { contributions, isLoading: contributions === undefined };
}
