/**
 * useContribution — a single contribution by id (live-updating, so status
 * changes from the pipeline stream into the detail screen).
 */
import { useAuthenticatedQuery } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";
import type { Contribution } from "../types";

export function useContribution(id: Id<"devBugs"> | null): {
  contribution: Contribution | null | undefined;
  isLoading: boolean;
} {
  const contribution = useAuthenticatedQuery(
    contributionsApi.getContribution,
    id ? { id } : "skip",
  );
  return { contribution, isLoading: contribution === undefined };
}
