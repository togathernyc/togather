/**
 * useConvexFeatureFlag
 *
 * Reads a single feature flag from the Convex `featureFlags` table.
 * Returns `{ enabled, loaded }` so callers can render a brief loading state
 * (rather than flashing the disabled UI on rollout-cohort users) while the
 * query hydrates.
 *
 * Use this for the new DB-backed flags flipped via `/(user)/admin/features`.
 * The PostHog-backed `useFeatureFlag` in `./useFeatureFlag.ts` is still
 * available for cases where per-cohort targeting is genuinely needed — but
 * for staged on/off rollouts, prefer this one (Seyi finds PostHog too
 * complex for those flows).
 */
import { useQuery, api } from "@services/api/convex";

export function useConvexFeatureFlag(key: string): {
  enabled: boolean;
  loaded: boolean;
} {
  const value = useQuery(api.functions.admin.featureFlags.getFeatureFlag, {
    key,
  });
  return {
    enabled: value === true,
    loaded: value !== undefined,
  };
}
