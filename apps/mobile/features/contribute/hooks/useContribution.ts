/**
 * useContribution — a single contribution by id (live-updating, so status
 * changes from the pipeline stream into the detail screen).
 * Pass null to skip (no id yet, or dev-dashboard access not confirmed).
 */
import { api, useAuthenticatedQuery } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { Contribution } from "../types";

export function useContribution(id: Id<"devBugs"> | null): {
  contribution: Contribution | null | undefined;
  isLoading: boolean;
} {
  const contribution: Contribution | null | undefined = useAuthenticatedQuery(
    api.functions.devAssistant.contributions.getContribution,
    id ? { id } : "skip",
  );
  return { contribution, isLoading: contribution === undefined };
}
