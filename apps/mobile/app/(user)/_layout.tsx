import { Stack } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { SafeAreaView } from "react-native-safe-area-context";

export default function UserLayout() {
  return (
    <UserRoute>
      <Stack
        initialRouteName="redirect"
        screenOptions={{
          headerShown: false,
        }}
      />
    </UserRoute>
  );
}
