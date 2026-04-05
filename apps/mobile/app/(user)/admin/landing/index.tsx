import { Stack } from "expo-router";
import { LandingPageContent } from "@features/admin";

export default function LandingPageRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Landing Page",
          headerBackTitle: "Back",
        }}
      />
      <LandingPageContent />
    </>
  );
}
