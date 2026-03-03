import { Stack } from "expo-router";
import { RegisterPhoneScreen } from "@features/auth";

export default function RegisterPhonePage() {
  return (
    <>
      <Stack.Screen options={{ title: "Register Phone", headerShown: false }} />
      <RegisterPhoneScreen />
    </>
  );
}
