import { Stack } from "expo-router";

export default function RsvpLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="phone" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="confirm" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="success" />
    </Stack>
  );
}
