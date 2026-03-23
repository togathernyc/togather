import { Stack } from "expo-router";

/**
 * Public marketing / community landing routes (nearme, legal, etc.).
 * Root stack presents this group as a modal (see app/_layout.tsx).
 */
export default function LandingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
