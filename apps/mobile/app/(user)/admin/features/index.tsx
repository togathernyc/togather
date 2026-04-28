import { Stack } from "expo-router";
import { FeatureFlagsContent } from "@features/admin";

export default function FeatureFlagsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Feature Flags",
          headerBackTitle: "Back",
        }}
      />
      <FeatureFlagsContent />
    </>
  );
}
