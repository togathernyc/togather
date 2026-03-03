/**
 * External Chat Modal Component
 * Prompts user to join external chat platform (WhatsApp, Telegram, etc.)
 */
import React, { memo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getExternalChatInfo, openExternalChatLink } from "../utils/externalChat";

type ExternalChatModalProps = {
  visible: boolean;
  externalChatLink: string | null;
  onClose: () => void;
};

export const ExternalChatModal = memo(function ExternalChatModal({
  visible,
  externalChatLink,
  onClose,
}: ExternalChatModalProps) {
  const externalChatInfo = externalChatLink ? getExternalChatInfo(externalChatLink) : null;

  const handleOpenExternalChat = useCallback(async () => {
    if (!externalChatLink) return;

    try {
      await openExternalChatLink(externalChatLink);
      onClose();
    } catch {
      Alert.alert(
        "Unable to Open Link",
        "There was a problem opening the external chat link. Please try again.",
        [{ text: "OK" }]
      );
    }
  }, [externalChatLink, onClose]);

  if (!externalChatInfo || !externalChatLink) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
          {/* Platform Icon */}
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: externalChatInfo.color + "15" },
            ]}
          >
            <Ionicons
              name={externalChatInfo.iconName as keyof typeof Ionicons.glyphMap}
              size={48}
              color={externalChatInfo.color}
            />
          </View>

          {/* Title */}
          <Text style={styles.title}>Join on {externalChatInfo.name}</Text>

          {/* Description */}
          <Text style={styles.description}>{externalChatInfo.description}</Text>

          {/* Open Button */}
          <TouchableOpacity
            style={[styles.openButton, { backgroundColor: externalChatInfo.color }]}
            onPress={handleOpenExternalChat}
          >
            <Text style={styles.openButtonText}>Open {externalChatInfo.name}</Text>
          </TouchableOpacity>

          {/* Cancel Button */}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Maybe Later</Text>
          </TouchableOpacity>
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
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  openButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  openButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  cancelButton: {
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: "#666",
    fontSize: 15,
    fontWeight: "500",
  },
});
