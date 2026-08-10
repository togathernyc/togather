/**
 * RosteringBackHeader — a simple back-chevron + title bar.
 *
 * Grid-first IA (Stage 1) removed the shared Rostering hub chrome, so the
 * standalone Teams / Cross-team screens (reached from the grid's ⋯ overflow)
 * supply their own header. Mirrors the grid's own header treatment.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

export function RosteringBackHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.surface }}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          hitSlop={12}
          style={styles.side}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <View style={styles.side} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 36, padding: 4 },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
});
