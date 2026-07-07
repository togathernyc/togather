/**
 * Conversation-list queries: the current user's contributions and (for
 * maintainers) everyone's. Newest first, each with a snippet of the latest
 * thread message.
 */
import { useAuthenticatedQuery } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";
import type { ContributionListItem } from "../types";

export function useMyContributions(): {
  contributions: ContributionListItem[] | undefined;
  isLoading: boolean;
} {
  const contributions = useAuthenticatedQuery(contributionsApi.myContributions, {});
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
  const contributions = useAuthenticatedQuery(
    contributionsApi.listAll,
    enabled ? {} : "skip",
  );
  return { contributions, isLoading: contributions === undefined };
}
