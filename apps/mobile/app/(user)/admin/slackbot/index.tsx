import { Stack } from "expo-router";
import { SlackBotConfigScreen } from "@features/admin";

export default function SlackBotConfigRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Slack Bot Config",
          headerBackTitle: "Back",
        }}
      />
      <SlackBotConfigScreen />
    </>
  );
}
