import { Stack } from "expo-router";
import { SignUpScreen } from "@features/auth";

export default function SignUpPage() {
  return (
    <>
      <Stack.Screen options={{ title: "", headerShown: false }} />
      <SignUpScreen />
    </>
  );
}
