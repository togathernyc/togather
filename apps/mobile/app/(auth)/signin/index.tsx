import { Stack } from "expo-router";
import { PhoneSignInScreen } from "@features/auth";

export default function SignInPage() {
  return (
    <>
      <Stack.Screen options={{ title: "", headerShown: false }} />
      <PhoneSignInScreen />
    </>
  );
}
