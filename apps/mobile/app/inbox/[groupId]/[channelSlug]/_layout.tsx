import { Stack } from "expo-router";

/**
 * Layout for channel-specific routes
 *
 * Provides stack navigation for:
 * - /inbox/[groupId]/[channelSlug] - Channel chat (index)
 * - /inbox/[groupId]/[channelSlug]/members - Legacy member management screen
 * - /inbox/[groupId]/[channelSlug]/info - Channel info screen (DM aesthetic)
 * - /inbox/[groupId]/[channelSlug]/info/* - Picker sub-screens (join-mode,
 *   active-state) and the rename modal launched from info.
 */
export default function ChannelLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* Channel chat - default route */}
      <Stack.Screen name="index" options={{ animation: "none" }} />
      {/* Members management - slide animation */}
      <Stack.Screen name="members" options={{ animation: "slide_from_right" }} />
      {/* Channel info screen + nested pickers */}
      <Stack.Screen name="info" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
