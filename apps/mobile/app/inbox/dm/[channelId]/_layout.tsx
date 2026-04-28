import { Stack } from "expo-router";

/**
 * Layout for an individual direct-message channel
 *
 * Mirrors the legacy `[chat_id]` layout: a single-screen Stack so the
 * parent `dm/_layout.tsx` declaration `<Stack.Screen name="[channelId]" />`
 * resolves to a nested navigator rather than flattening to
 * "[channelId]/index" (which can mis-match screen names and trigger
 * navigator re-render loops).
 */
export default function DmChannelLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ animation: "none" }} />
      <Stack.Screen name="info" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="thread" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
