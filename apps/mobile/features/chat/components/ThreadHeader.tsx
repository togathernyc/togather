/**
 * ThreadHeader Component
 *
 * Header for thread page showing "Thread" title with channel name and back navigation.
 */
import React, { memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface ThreadHeaderProps {
  channelName?: string;
  onBack: () => void;
}

export const ThreadHeader = memo(function ThreadHeader({
  channelName,
  onBack,
}: ThreadHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.headerInfo}>
        <Text style={[styles.title, { color: colors.text }]}>Thread</Text>
        {channelName && (
          <Text style={[styles.channelName, { color: colors.textSecondary }]}>#{channelName}</Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  channelName: {
    fontSize: 13,
    marginTop: 1,
  },
});
