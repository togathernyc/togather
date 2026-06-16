import { Stack } from "expo-router";
import { DeveloperApiKeysScreen } from "@features/admin";

export default function DeveloperApiKeysRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "API Keys",
          headerBackTitle: "Back",
        }}
      />
      <DeveloperApiKeysScreen />
    </>
  );
}
