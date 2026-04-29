import { Stack } from "expo-router";

/**
 * Layout for channel info screen + nested picker sub-routes.
 *
 * Routes:
 * - /inbox/[groupId]/[channelSlug]/info             - Main info screen
 * - /inbox/[groupId]/[channelSlug]/info/join-mode   - Join mode picker
 * - /inbox/[groupId]/[channelSlug]/info/active-state - Active/Disabled picker
 * - /inbox/[groupId]/[channelSlug]/info/rename      - Rename modal
 */
export default function ChannelInfoLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ animation: "none" }} />
      <Stack.Screen name="join-mode" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="active-state" options={{ animation: "slide_from_right" }} />
      <Stack.Screen
        name="rename"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}
