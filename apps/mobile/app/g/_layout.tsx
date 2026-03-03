import { Stack } from "expo-router";

/**
 * Layout for public group pages (/g/[shortId])
 * These pages are accessible without authentication.
 * Users can view group details but need to sign in to join.
 */
export default function GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
