import { Stack } from "expo-router";

/**
 * Public marketing / community landing routes (nearme, legal, etc.).
 * Modal presentation so universal links opened from Safari/email feel like a sheet
 * the user can swipe down to dismiss (iOS) instead of a full-screen trap.
 */
export default function LandingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: "modal",
        animation: "slide_from_bottom",
        gestureEnabled: true,
      }}
    />
  );
}
