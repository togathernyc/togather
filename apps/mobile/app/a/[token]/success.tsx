import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

export default function AvailabilitySuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();

  // Auto-redirect back to the availability page after a short delay
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(`/a/${token}`);
    }, 3000);

    return () => clearTimeout(timer);
  }, [router, token]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        <Text style={[styles.message, { color: colors.text }]}>
          Availability submitted!
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  message: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 24,
  },
});
