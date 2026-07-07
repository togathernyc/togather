/**
 * GitHub co-author credit — read and save the contributor's GitHub username
 * so their shipped changes are co-authored to their GitHub profile.
 */
import { useAuthenticatedMutation, useAuthenticatedQuery } from "@services/api/convex";
import { contributionsApi } from "./contributionsApi";

/**
 * The current user's GitHub username.
 * `undefined` = still loading, `null` = not set.
 */
export function useGithubUsername(): string | null | undefined {
  return useAuthenticatedQuery(contributionsApi.getGithubUsername, {});
}

/**
 * Save the current user's GitHub username (pass "" to clear). Throws a
 * ConvexError when the backend rejects an invalid username.
 */
export function useSetGithubUsername() {
  return useAuthenticatedMutation(contributionsApi.setGithubUsername);
}
