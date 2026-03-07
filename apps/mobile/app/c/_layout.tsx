import { Stack } from "expo-router";

/**
 * Layout for community landing pages (/c/[slug])
 * These pages are accessible without authentication.
 */
export default function CommunityLandingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
