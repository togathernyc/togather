import { Stack } from "expo-router";
import { PosterAdminScreen } from "@features/admin";

export default function PosterAdminRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PosterAdminScreen />
    </>
  );
}
