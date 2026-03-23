import { Stack } from "expo-router";

/**
 * Layout for community landing pages (/c/[slug]) — the configurable "connect card"
 * / welcome form. Root stack presents this segment as a modal (see app/_layout.tsx).
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
