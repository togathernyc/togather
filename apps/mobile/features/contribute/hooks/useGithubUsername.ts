/**
 * GitHub co-author credit — read and save the contributor's GitHub username
 * so their shipped changes are co-authored to their GitHub profile.
 */
import { api, useAuthenticatedMutation, useAuthenticatedQuery } from "@services/api/convex";

/**
 * The current user's GitHub username.
 * `undefined` = still loading, `null` = not set.
 */
export function useGithubUsername(): string | null | undefined {
  return useAuthenticatedQuery(
    api.functions.devAssistant.contributions.getGithubUsername,
    {},
  );
}

/**
 * Save the current user's GitHub username (pass "" to clear). Throws a
 * ConvexError when the backend rejects an invalid username.
 */
export function useSetGithubUsername() {
  return useAuthenticatedMutation(api.functions.devAssistant.contributions.setGithubUsername);
}
