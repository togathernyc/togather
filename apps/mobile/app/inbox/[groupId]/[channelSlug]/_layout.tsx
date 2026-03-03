import { Stack } from "expo-router";

/**
 * Layout for channel-specific routes
 *
 * Provides stack navigation for:
 * - /inbox/[groupId]/[channelSlug] - Channel chat (index)
 * - /inbox/[groupId]/[channelSlug]/members - Channel member management
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
    </Stack>
  );
}
