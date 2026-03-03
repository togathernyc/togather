import { View, ActivityIndicator } from "react-native";
import { useCommunitySubdomain } from "@features/auth/hooks/useCommunitySubdomain";
import { useInitialRouting } from "@features/auth/hooks/useInitialRouting";

/**
 * App Home Screen
 *
 * On native (iOS/Android): Handles initial routing based on auth state.
 * On web: The index+api.ts API route intercepts requests to serve the landing page.
 *
 * Handles:
 * - Community subdomain detection from URL params
 * - Initial routing based on authentication state
 */
export default function Index() {
  // Handle community subdomain from URL query parameter
  useCommunitySubdomain();

  // Handle initial routing based on authentication state
  const { isLoading, forceShow } = useInitialRouting();

  // Don't show loading spinner if forceShow is true
  if (isLoading && !forceShow) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Show loading while redirecting
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
