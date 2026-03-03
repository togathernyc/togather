import { Stack } from "expo-router";
import { SlackBotActivityScreen } from "@features/admin";

export default function SlackBotActivityRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Bot Activity Log",
          headerBackTitle: "Back",
        }}
      />
      <SlackBotActivityScreen />
    </>
  );
}
