import { Stack } from "expo-router";
import { CommunitySelectionScreen } from "@features/auth";

export default function SelectCommunityPage() {
  return (
    <>
      <Stack.Screen options={{ title: "Select Community", headerShown: false }} />
      <CommunitySelectionScreen />
    </>
  );
}
