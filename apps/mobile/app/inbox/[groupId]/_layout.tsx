import { Stack } from "expo-router";

/**
 * Layout for group inbox routes
 *
 * Provides stack navigation for:
 * - /inbox/[groupId]/general - General channel (via [channelSlug])
 * - /inbox/[groupId]/leaders - Leaders channel (via [channelSlug])
 * - /inbox/[groupId]/custom-slug - Custom channels (via [channelSlug])
 * - /inbox/[groupId]/thread/[messageId] - Thread view
 * - /inbox/[groupId]/create - Channel creation screen
 * - /inbox/[groupId]/[channelSlug]/members - Channel member management
 */
export default function GroupInboxLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* Channel routes - no animation for instant switching between channels */}
      <Stack.Screen name="[channelSlug]" options={{ animation: "none" }} />
      <Stack.Screen name="index" options={{ animation: "none" }} />
      {/* Thread view - keep slide animation */}
      <Stack.Screen name="thread" options={{ animation: "slide_from_right" }} />
      {/* Channel creation - slide animation */}
      <Stack.Screen name="create" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
