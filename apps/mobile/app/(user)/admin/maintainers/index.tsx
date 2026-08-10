import { Stack } from "expo-router";
import { MaintainersContent } from "@features/admin";

export default function MaintainersRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Maintainers",
          headerBackTitle: "Back",
        }}
      />
      <MaintainersContent />
    </>
  );
}
