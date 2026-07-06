/**
 * Contribution mutations — thin authenticated wrappers around
 * api.functions.devAssistant.contributions.
 */
import { useAuthenticatedMutation } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";

/** Submit a new bug/feature. Resolves to the new contribution's id. */
export function useSubmitContribution() {
  return useAuthenticatedMutation(contributionsApi.submit);
}

/**
 * Approve the AI spec (the contributor's product review). Low-risk items
 * start building automatically after this; medium/high wait for startBuild.
 */
export function useApproveSpec() {
  return useAuthenticatedMutation(contributionsApi.approveSpec);
}

/** Explicitly start the build for an approved medium/high-risk item. */
export function useStartBuild() {
  return useAuthenticatedMutation(contributionsApi.startBuild);
}
