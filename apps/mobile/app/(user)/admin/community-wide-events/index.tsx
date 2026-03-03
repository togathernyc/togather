import { Stack } from "expo-router";
import { CommunityWideEventsScreen } from "@features/admin";

export default function CommunityWideEventsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Community-Wide Events",
          headerBackTitle: "Back",
        }}
      />
      <CommunityWideEventsScreen />
    </>
  );
}
