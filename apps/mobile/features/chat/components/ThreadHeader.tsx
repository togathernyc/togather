/**
 * ThreadHeader Component
 *
 * Header for thread page showing "Thread" title with channel name and back navigation.
 */
import React, { memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ThreadHeaderProps {
  channelName?: string;
  onBack: () => void;
}

export const ThreadHeader = memo(function ThreadHeader({
  channelName,
  onBack,
}: ThreadHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={28} color="#000" />
      </TouchableOpacity>

      <View style={styles.headerInfo}>
        <Text style={styles.title}>Thread</Text>
        {channelName && (
          <Text style={styles.channelName}>#{channelName}</Text>
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
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
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
    color: "#000",
  },
  channelName: {
    fontSize: 13,
    color: "#666",
    marginTop: 1,
  },
});
