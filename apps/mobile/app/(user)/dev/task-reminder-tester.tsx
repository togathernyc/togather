/**
 * Task Reminder Tester Page
 *
 * A dev tool to test the task reminder bot functionality.
 *
 * Features:
 * - Select a group you're a leader in
 * - Select a member to mention
 * - Enter a custom reminder message
 * - Choose chat target (main vs leaders)
 * - Send test message with mention (triggers push + email)
 *
 * Only accessible in dev/staging builds.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Card, Button, Select } from "@components/ui";
import { useAuth } from "@/providers/AuthProvider";
import { Environment } from "@/services/environment";
import { useDevToolsEscapeHatch } from "@/hooks/useDevToolsEscapeHatch";
import { UserRoute } from "@components/guards/UserRoute";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

type ChatTarget = "main" | "leaders";

export default function TaskReminderTesterPage() {
  const insets = useSafeAreaInsets();
  const { token, user, community } = useAuth();
  const { isEnabled: devToolsEnabled } = useDevToolsEscapeHatch();

  // Form state
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [message, setMessage] = useState("Don't forget to buy snacks for today's meeting!");
  const [chatTarget, setChatTarget] = useState<ChatTarget>("leaders");

  // Result state
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Get user's groups
  const groups = useQuery(
    api.functions.groups.queries.listForUser,
    token && community?.id
      ? { token, communityId: community.id as Id<"communities"> }
      : "skip"
  );

  // Filter to groups where user is a leader
  const leaderGroups = useMemo(() => {
    if (!groups) return [];
    return groups.filter((g: any) => g.userRole === "leader");
  }, [groups]);

  // Get members of selected group
  const groupMembers = useQuery(
    api.functions.groupMembers.list,
    selectedGroupId && token
      ? {
          groupId: selectedGroupId as Id<"groups">,
          token,
          limit: 200,
        }
      : "skip"
  );

  // Extract items from paginated response
  const members = useMemo(() => {
    if (!groupMembers) return [];
    return Array.isArray(groupMembers) ? groupMembers : groupMembers.items || [];
  }, [groupMembers]);

  // Get the test action
  const testTaskReminder = useAction(api.functions.groupBots.testTaskReminder);

  // Check if we should show dev tools
  const shouldShow = __DEV__ || Environment.isStaging() || devToolsEnabled;

  if (!shouldShow) {
    return (
      <UserRoute>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <Text style={styles.errorText}>
            Developer tools are only available in dev/staging builds.
          </Text>
        </View>
      </UserRoute>
    );
  }

  const handleSendTest = async () => {
    if (!selectedGroupId || !selectedMemberId || !message.trim() || !token) {
      setLastResult("Please fill in all fields");
      return;
    }

    setIsSending(true);
    setLastResult(null);

    try {
      const result = await testTaskReminder({
        token,
        groupId: selectedGroupId as Id<"groups">,
        mentionUserId: selectedMemberId as Id<"users">,
        message: message.trim(),
        chatType: chatTarget,
      });

      if (result.success) {
        setLastResult(
          `✅ Message sent successfully!\n\nChannel: ${chatTarget}\nMessage ID: ${result.messageId}\n\nCheck ${chatTarget === "leaders" ? "leaders" : "main"} chat for the message.`
        );
      } else {
        setLastResult(`❌ Failed: ${result.error}`);
      }
    } catch (error: any) {
      setLastResult(`❌ Error: ${error.message || "Unknown error"}`);
    } finally {
      setIsSending(false);
    }
  };

  // Build group options for dropdown
  const groupOptions = leaderGroups.map((g: any) => ({
    value: g._id,
    label: g.name,
  }));

  // Build member options for dropdown
  const memberOptions = members.map((m: any) => ({
    value: m.user?.id || m.userId,
    label: m.user
      ? `${m.user.firstName || ""} ${m.user.lastName || ""}`.trim() || "Unknown"
      : "Unknown",
  }));

  return (
    <UserRoute>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Task Reminder Tester</Text>
            <Text style={styles.subtitle}>
              Test the task reminder bot by sending a message with a mention.
              The mentioned user will receive a push notification and email.
            </Text>
          </View>

          {/* Configuration Card */}
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Configuration</Text>

            {/* Group Selection */}
            <View style={styles.field}>
              <Text style={styles.label}>Group</Text>
              {groups === undefined ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : leaderGroups.length === 0 ? (
                <Text style={styles.noDataText}>
                  You're not a leader in any groups
                </Text>
              ) : (
                <Select
                  value={selectedGroupId}
                  onSelect={(value) => {
                    setSelectedGroupId(value as string);
                    setSelectedMemberId(""); // Reset member selection
                  }}
                  options={groupOptions}
                  placeholder="Select a group..."
                />
              )}
            </View>

            {/* Member Selection */}
            <View style={styles.field}>
              <Text style={styles.label}>Mention</Text>
              {!selectedGroupId ? (
                <Text style={styles.noDataText}>Select a group first</Text>
              ) : groupMembers === undefined ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : members.length === 0 ? (
                <Text style={styles.noDataText}>No members in this group</Text>
              ) : (
                <Select
                  value={selectedMemberId}
                  onSelect={(value) => setSelectedMemberId(value as string)}
                  options={memberOptions}
                  placeholder="Select a member to mention..."
                />
              )}
            </View>

            {/* Message Input */}
            <View style={styles.field}>
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={styles.textInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Enter reminder message..."
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Chat Target */}
            <View style={styles.field}>
              <Text style={styles.label}>Send to</Text>
              <View style={styles.radioGroup}>
                <TouchableOpacity
                  style={[
                    styles.radioOption,
                    chatTarget === "leaders" && styles.radioOptionSelected,
                  ]}
                  onPress={() => setChatTarget("leaders")}
                >
                  <Ionicons
                    name={chatTarget === "leaders" ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={chatTarget === "leaders" ? "#007AFF" : "#999"}
                  />
                  <Text
                    style={[
                      styles.radioLabel,
                      chatTarget === "leaders" && styles.radioLabelSelected,
                    ]}
                  >
                    Leaders Chat
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.radioOption,
                    chatTarget === "main" && styles.radioOptionSelected,
                  ]}
                  onPress={() => setChatTarget("main")}
                >
                  <Ionicons
                    name={chatTarget === "main" ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={chatTarget === "main" ? "#007AFF" : "#999"}
                  />
                  <Text
                    style={[
                      styles.radioLabel,
                      chatTarget === "main" && styles.radioLabelSelected,
                    ]}
                  >
                    Main Chat
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>

          {/* Send Button */}
          <Button
            onPress={handleSendTest}
            disabled={isSending || !selectedGroupId || !selectedMemberId || !message.trim()}
            loading={isSending}
            style={styles.sendButton}
          >
            {isSending ? "Sending..." : "Send Test Message"}
          </Button>

          {/* Result */}
          {lastResult && (
            <Card style={styles.resultCard}>
              <Text style={styles.sectionTitle}>Result</Text>
              <Text
                style={[
                  styles.resultText,
                  lastResult.startsWith("✅") && styles.resultSuccess,
                  lastResult.startsWith("❌") && styles.resultError,
                ]}
              >
                {lastResult}
              </Text>
            </Card>
          )}

          {/* Info Card */}
          <Card style={styles.infoCard}>
            <View style={styles.infoHeader}>
              <Ionicons name="information-circle" size={20} color="#007AFF" />
              <Text style={styles.infoTitle}>How it works</Text>
            </View>
            <Text style={styles.infoText}>
              This sends a bot message to the selected chat with an @mention of
              the selected member. The mention triggers:{"\n\n"}
              • Push notification to the mentioned user{"\n"}
              • Email to the mentioned user{"\n\n"}
              This is the same flow used by the task reminder bot in production.
            </Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    lineHeight: 21,
  },
  card: {
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000",
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
  },
  radioGroup: {
    flexDirection: "row",
    gap: 16,
  },
  radioOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  radioOptionSelected: {
    backgroundColor: "#e6f2ff",
  },
  radioLabel: {
    fontSize: 15,
    color: "#666",
  },
  radioLabelSelected: {
    color: "#007AFF",
    fontWeight: "500",
  },
  sendButton: {
    marginBottom: 16,
  },
  resultCard: {
    padding: 16,
    marginBottom: 16,
  },
  resultText: {
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 20,
  },
  resultSuccess: {
    color: "#34C759",
  },
  resultError: {
    color: "#FF3B30",
  },
  infoCard: {
    padding: 16,
    backgroundColor: "#f0f7ff",
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#007AFF",
  },
  infoText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  noDataText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    padding: 20,
  },
});
