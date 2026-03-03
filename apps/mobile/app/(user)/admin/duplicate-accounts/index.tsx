import { Stack } from "expo-router";
import { DuplicateAccountsScreen } from "@features/admin";

export default function DuplicateAccountsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Duplicate Accounts",
          headerBackTitle: "Back",
        }}
      />
      <DuplicateAccountsScreen />
    </>
  );
}
