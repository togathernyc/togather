import { Stack } from "expo-router";

/**
 * Layout for community landing pages (/c/[slug]) — the configurable "connect card"
 * / welcome form. Modal presentation matches (landing) so universal links open as
 * a sheet users can swipe down to dismiss (iOS).
 */
export default function CommunityLandingLayout() {
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
