import { Stack } from "expo-router";

/**
 * Layout for legacy chat_id routes
 *
 * This layout is required so Expo Router resolves the directory as a nested
 * navigator with screen name "[chat_id]", matching the declaration in the
 * parent inbox/_layout.tsx. Without it the route flattens to "[chat_id]/index"
 * which causes a name mismatch and can trigger infinite re-renders in the
 * tab navigator (REACT-NATIVE-3F).
 */
export default function ChatIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ animation: "none" }} />
    </Stack>
  );
}
