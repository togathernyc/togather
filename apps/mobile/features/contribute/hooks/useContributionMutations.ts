/**
 * Contribution mutations — thin authenticated wrappers around
 * api.functions.devAssistant.contributions.
 */
import { api, useAuthenticatedMutation } from "@services/api/convex";

const contributions = api.functions.devAssistant.contributions;

/** Submit a new bug/feature. Resolves to the new contribution's id. */
export function useSubmitContribution() {
  return useAuthenticatedMutation(contributions.submit);
}

/**
 * Approve the AI spec (the contributor's product review). Low-risk items
 * start building automatically after this; medium/high wait for startBuild.
 * The backend rejects items whose scope is "split" or "design_needed".
 * Resolves to { ok, autoDispatched }.
 */
export function useApproveSpec() {
  return useAuthenticatedMutation(contributions.approveSpec);
}

/** Explicitly start the build for an approved medium/high-risk item. */
export function useStartBuild() {
  return useAuthenticatedMutation(contributions.startBuild);
}

/**
 * Post a message to the conversation thread. While the item is in
 * DRAFT/IN_REVIEW this also asks the AI to revise the spec. Resolves to the
 * new message id.
 */
export function usePostMessage() {
  return useAuthenticatedMutation(contributions.postMessage);
}

/** Confirm the change works on the staging app ("Works — ship it"). */
export function useConfirmStaging() {
  return useAuthenticatedMutation(contributions.confirmStaging);
}

/**
 * Report that the staging build isn't right, with a short note. Sends the
 * item back through the build pipeline — a fresh AI run fixes the reported
 * problems and opens a new PR.
 */
export function useReportStagingIssue() {
  return useAuthenticatedMutation(contributions.reportStagingIssue);
}

/** Merge the review-approved PR from the app (ships it to staging). */
export function useMergeNow() {
  return useAuthenticatedMutation(contributions.mergeNow);
}

/** Trigger the production deploy from the app (always a silent update). */
export function usePromoteToProduction() {
  return useAuthenticatedMutation(contributions.promoteToProduction);
}

/** Archive (set aside) a conversation the contributor is abandoning. */
export function useArchiveContribution() {
  return useAuthenticatedMutation(contributions.archive);
}

/** Restore an archived conversation to the active dashboard. */
export function useUnarchiveContribution() {
  return useAuthenticatedMutation(contributions.unarchive);
}
