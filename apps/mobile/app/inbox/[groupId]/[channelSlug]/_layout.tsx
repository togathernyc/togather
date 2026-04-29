import { Stack } from "expo-router";

/**
 * Layout for channel-specific routes
 *
 * Provides stack navigation for:
 * - /inbox/[groupId]/[channelSlug]                       - Channel chat (index)
 * - /inbox/[groupId]/[channelSlug]/members               - Channel member management
 * - /inbox/[groupId]/[channelSlug]/info                  - Channel info (DM-style)
 * - /inbox/[groupId]/[channelSlug]/info/active-state     - Active/Disabled picker
 * - /inbox/[groupId]/[channelSlug]/info/join-mode        - Open / Approval-required picker
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
      {/* Channel info - slide animation */}
      <Stack.Screen name="info/index" options={{ animation: "slide_from_right" }} />
      <Stack.Screen
        name="info/active-state"
        options={{ animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="info/join-mode"
        options={{ animation: "slide_from_right" }}
      />
    </Stack>
  );
}
