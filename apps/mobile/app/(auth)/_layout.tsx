import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="signin/index" options={{ headerShown: false }} />
      <Stack.Screen name="signup/index" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password/index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome/index" options={{ headerShown: false }} />
      <Stack.Screen name="select-community/index" options={{ headerShown: false }} />
      <Stack.Screen name="register-phone/index" options={{ headerShown: false }} />
      <Stack.Screen name="confirm-identity/index" options={{ headerShown: false }} />
      <Stack.Screen name="user-type/index" options={{ headerShown: false }} />
      <Stack.Screen name="claim-account/email/index" options={{ headerShown: false }} />
      <Stack.Screen name="claim-account/verify/index" options={{ headerShown: false }} />
      <Stack.Screen name="claim-account/request-review/index" options={{ headerShown: false }} />
      <Stack.Screen name="join-flow/index" options={{ headerShown: false }} />
    </Stack>
  );
}
