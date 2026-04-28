import { Stack } from "expo-router";

/**
 * Layout for DM thread routes
 *
 * Mirrors `apps/mobile/app/inbox/[groupId]/thread/_layout.tsx`. Required so
 * Expo Router resolves the directory as a nested navigator with screen name
 * "thread", matching the parent `[channelId]/_layout.tsx` declaration.
 * Without it the route flattens to "thread/[messageId]" and can trigger
 * navigator re-render loops.
 */
export default function DmThreadLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="[messageId]" options={{ animation: "none" }} />
    </Stack>
  );
}
