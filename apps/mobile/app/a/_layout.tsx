import { Stack } from "expo-router";

/**
 * Layout for public availability pages (/a/[token])
 * These pages are accessible without authentication.
 * Visitors can mark availability but verify their phone (SMS OTP) before it's recorded.
 */
export default function AvailabilityLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
