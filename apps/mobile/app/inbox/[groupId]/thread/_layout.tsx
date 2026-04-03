import { Stack } from "expo-router";

/**
 * Layout for thread routes
 *
 * This layout is required so Expo Router resolves the directory as a nested
 * navigator with screen name "thread", matching the declaration in the parent
 * [groupId]/_layout.tsx. Without it the route flattens to "thread/[messageId]"
 * which causes a name mismatch and can trigger infinite re-renders in the
 * tab navigator (REACT-NATIVE-3F).
 */
export default function ThreadLayout() {
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
