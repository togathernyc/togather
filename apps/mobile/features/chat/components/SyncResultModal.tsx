/**
 * Sync Result Modal Component
 * Displays PCO sync results showing channel sync status and member changes
 */
import React, { memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type SyncResult = {
  channelName: string;
  status: "synced" | "skipped" | "error";
  addedCount: number;
  removedCount: number;
  reason?: string;
};

type SyncResultModalProps = {
  visible: boolean;
  results: SyncResult[] | null;
  loading?: boolean;
  onClose: () => void;
};

const STATUS_CONFIG = {
  synced: {
    icon: "checkmark-circle" as const,
    color: "#4CAF50",
  },
  skipped: {
    icon: "warning" as const,
    color: "#FF9800",
  },
  error: {
    icon: "close-circle" as const,
    color: "#F44336",
  },
};

function getSummaryText(result: SyncResult): string {
  if (result.status === "synced") {
    if (result.addedCount === 0 && result.removedCount === 0) {
      return "No changes";
    }
    const parts: string[] = [];
    if (result.addedCount > 0) {
      parts.push(`${result.addedCount} member${result.addedCount === 1 ? "" : "s"} added`);
    }
    if (result.removedCount > 0) {
      parts.push(`${result.removedCount} removed`);
    }
    return parts.join(", ");
  }
  return result.reason || "Unknown reason";
}

export const SyncResultModal = memo(function SyncResultModal({
  visible,
  results,
  loading = false,
  onClose,
}: SyncResultModalProps) {
  const renderResultItem = (result: SyncResult, index: number) => {
    const config = STATUS_CONFIG[result.status];
    const summaryText = getSummaryText(result);

    return (
      <View key={index} style={styles.resultItem}>
        <View style={styles.resultHeader}>
          <Ionicons name={config.icon} size={20} color={config.color} />
          <Text style={styles.channelName} numberOfLines={1}>
            {result.channelName}
          </Text>
        </View>
        <Text
          style={[
            styles.summaryText,
            result.status !== "synced" && { color: config.color },
          ]}
          numberOfLines={2}
        >
          {summaryText}
        </Text>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {loading ? "Syncing..." : "Sync Complete"}
            </Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#1976D2" />
              <Text style={styles.loadingText}>Syncing members...</Text>
            </View>
          ) : results && results.length > 0 ? (
            <ScrollView
              style={styles.resultsList}
              contentContainerStyle={styles.resultsContent}
              showsVerticalScrollIndicator={false}
            >
              {results.map(renderResultItem)}
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No sync results</Text>
            </View>
          )}

          {/* Done Button */}
          {!loading && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.doneButton} onPress={onClose}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    width: "100%",
    maxWidth: 340,
    maxHeight: "70%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  divider: {
    height: 1,
    backgroundColor: "#E0E0E0",
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },
  resultsList: {
    maxHeight: 300,
  },
  resultsContent: {
    paddingVertical: 8,
  },
  resultItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  channelName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
  },
  summaryText: {
    fontSize: 13,
    color: "#666",
    marginLeft: 28,
  },
  doneButton: {
    paddingVertical: 14,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
  },
});
