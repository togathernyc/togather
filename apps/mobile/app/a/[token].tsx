import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, useQuery } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

/**
 * Deep-link target for a public availability link: `https://togather.nyc/a/<token>`.
 *
 * App users who tap the link land here. We resolve the request's group from the
 * public token (no auth needed) and forward them to the in-app "My Availability"
 * page, where they can mark availability across the group's upcoming events.
 * The browser handles everyone without the app. See ADR-023.
 */
export default function AvailabilityLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { colors } = useTheme();

  const request = useQuery(
    api.functions.scheduling.publicAvailability.getPublicAvailabilityRequest,
    token ? { publicToken: token } : "skip",
  );

  useEffect(() => {
    if (request === undefined) return; // still loading
    if (request === null) {
      router.replace("/");
      return;
    }
    router.replace(`/rostering/${request.groupId}/availability` as never);
  }, [request, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <ActivityIndicator size="small" color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
