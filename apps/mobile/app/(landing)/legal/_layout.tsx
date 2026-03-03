import { Stack, useRouter } from "expo-router";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

function BackButton() {
  const router = useRouter();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Fallback to sign-in screen directly if no history
      // Using replace to avoid adding to history stack
      router.replace("/(auth)/signin");
    }
  };
  return (
    <TouchableOpacity onPress={handleBack} style={styles.backButton}>
      <Ionicons name="chevron-back" size={24} color="#007AFF" />
      <Text style={styles.backText}>Back</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: -8,
  },
  backText: {
    color: "#007AFF",
    fontSize: 17,
  },
});

export default function LegalLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="privacy"
        options={{
          headerShown: true,
          title: "Privacy Policy",
          headerLeft: () => <BackButton />,
        }}
      />
      <Stack.Screen
        name="terms"
        options={{
          headerShown: true,
          title: "Terms of Service",
          headerLeft: () => <BackButton />,
        }}
      />
      <Stack.Screen
        name="policies"
        options={{
          headerShown: true,
          title: "Policies",
          headerLeft: () => <BackButton />,
        }}
      />
      <Stack.Screen
        name="copyright"
        options={{
          headerShown: true,
          title: "Copyright",
          headerLeft: () => <BackButton />,
        }}
      />
    </Stack>
  );
}
