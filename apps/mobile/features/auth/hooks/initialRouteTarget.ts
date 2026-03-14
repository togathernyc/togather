export interface InitialRouteTargetInput {
  isAuthenticated: boolean;
  hasCommunity: boolean;
  hasSlugParam: boolean;
  hasUserProfile: boolean;
}

/**
 * Determine where the index route should send the user.
 * Token-only sessions (no profile loaded yet) go to profile so the app
 * remains usable while offline instead of forcing sign-in.
 */
export function getInitialRouteTarget({
  isAuthenticated,
  hasCommunity,
  hasSlugParam,
  hasUserProfile,
}: InitialRouteTargetInput): string {
  if (!isAuthenticated) {
    return "/(auth)/landing";
  }

  if (hasCommunity || hasSlugParam) {
    return "/(tabs)/chat";
  }

  if (!hasUserProfile) {
    return "/(tabs)/profile";
  }

  return "/(auth)/landing";
}
