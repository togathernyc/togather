import { Stack } from "expo-router";

/**
 * Layout for public tool pages (/t/[shortId])
 * These pages are accessible without authentication.
 * Users can view tool content (Run Sheet, Resources) via shared links.
 */
export default function ToolLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
