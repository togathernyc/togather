import { Stack } from "expo-router";

/**
 * Layout for channel invite pages (/ch/[shortId])
 * These pages are accessible without authentication.
 * Users can view channel details and join via invite link.
 */
export default function ChannelInviteLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
