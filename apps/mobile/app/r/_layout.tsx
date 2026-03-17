import { Stack } from "expo-router";

/**
 * Layout for public resource/tool pages (/r/[shortId]).
 * These pages are accessible without authentication.
 */
export default function ResourceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
