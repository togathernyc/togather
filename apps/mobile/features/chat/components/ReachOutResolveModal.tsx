import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { Id } from "@services/api/convex";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface ReachOutResolveModalProps {
  visible: boolean;
  requestId: Id<"reachOutRequests">;
  onClose: () => void;
}

export function ReachOutResolveModal({
  visible,
  requestId,
  onClose,
}: ReachOutResolveModalProps) {
  const { primaryColor } = useCommunityTheme();
  const [notes, setNotes] = useState("");
  const [resolving, setResolving] = useState(false);

  const resolveRequest = useAuthenticatedMutation(
    api.functions.messaging.reachOut.resolveRequest
  );

  const handleResolve = useCallback(async () => {
    const trimmed = notes.trim();
    if (!trimmed) {
      Alert.alert("Required", "Please add resolution notes before resolving.");
      return;
    }

    setResolving(true);
    try {
      await resolveRequest({ requestId, resolutionNotes: trimmed });
      setNotes("");
      onClose();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to resolve request");
    } finally {
      setResolving(false);
    }
  }, [notes, resolveRequest, requestId, onClose]);

  const handleClose = useCallback(() => {
    if (!resolving) {
      setNotes("");
      onClose();
    }
  }, [resolving, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.overlay} onPress={handleClose}>
        <View style={styles.content} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Resolve Request</Text>
          <Text style={styles.subtitle}>
            Add notes about how this was resolved. This will be visible in the
            follow-up history.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Resolution notes..."
            placeholderTextColor="#999"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={500}
            autoFocus
            editable={!resolving}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              disabled={resolving}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.resolveButton,
                {
                  backgroundColor:
                    notes.trim().length > 0 ? primaryColor : "#ccc",
                },
              ]}
              onPress={handleResolve}
              disabled={resolving || notes.trim().length === 0}
            >
              {resolving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.resolveText}>Resolve</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: "top",
    color: "#333",
    marginBottom: 16,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  resolveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  resolveText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
