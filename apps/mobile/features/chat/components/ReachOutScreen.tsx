import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@services/api/convex";
import { useQuery, useAuthenticatedMutation, api, useStoredAuthToken } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ReachOutTaskCard } from "./ReachOutTaskCard";

interface ReachOutScreenProps {
  channelId: Id<"chatChannels">;
  groupId: Id<"groups">;
}

export function ReachOutScreen({ channelId, groupId }: ReachOutScreenProps) {
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requests = useQuery(
    api.functions.messaging.reachOut.getMyTaskRequests,
    token ? { token, groupId } : "skip"
  );

  const submitRequest = useAuthenticatedMutation(
    api.functions.messaging.reachOut.submitTaskRequest
  );

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed) return;

    Alert.alert(
      "Send to Leaders",
      "This message will be seen by all leaders in this group. They will try their best to get to you as soon as they can.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: async () => {
            setSubmitting(true);
            try {
              await submitRequest({
                groupId,
                channelId,
                content: trimmed,
              });
              setContent("");
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to send request");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }, [content, submitRequest, groupId, channelId]);

  const canSend = content.trim().length > 0 && !submitting;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={100}
    >
      {/* Input section */}
      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>What would you like to reach out about?</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="Type your message..."
            placeholderTextColor="#999"
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={1000}
            editable={!submitting}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: canSend ? primaryColor : "#ccc" },
            ]}
            onPress={handleSubmit}
            disabled={!canSend}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Requests list */}
      <View style={styles.listSection}>
        {requests === undefined ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="hand-left-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No requests yet</Text>
            <Text style={styles.emptySubtext}>
              Send a message above to reach out to your leaders
            </Text>
          </View>
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <ReachOutTaskCard task={item} variant="member" />
            )}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <Text style={styles.listHeader}>Your Requests</Text>
            }
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  inputSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 44,
    color: "#333",
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  listSection: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#666",
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 4,
  },
  listContent: {
    padding: 16,
  },
  listHeader: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
});
