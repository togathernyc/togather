import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="proposal/index" />
      <Stack.Screen name="setup/index" />
      <Stack.Screen name="success/index" />
    </Stack>
  );
}
