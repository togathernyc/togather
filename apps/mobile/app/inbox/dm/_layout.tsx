import { Stack } from "expo-router";

/**
 * Layout for direct-message routes
 *
 * Required so Expo Router resolves the `dm/[channelId]` directory as a nested
 * navigator with screen name "dm", matching the declaration in the parent
 * inbox/_layout.tsx. Without it the route flattens and the parent's
 * `<Stack.Screen name="dm" />` registration becomes a name mismatch.
 */
export default function DmLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="[channelId]" options={{ animation: "none" }} />
    </Stack>
  );
}
