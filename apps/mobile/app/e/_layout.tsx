import { Stack } from "expo-router";

/**
 * Layout for public event pages (/e/[shortId])
 * These pages are accessible without authentication.
 * Users can view event details but need to sign in to RSVP.
 */
export default function EventLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
