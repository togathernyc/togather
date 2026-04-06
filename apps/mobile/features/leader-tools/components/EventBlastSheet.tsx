import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";

interface EventBlastSheetProps {
  visible: boolean;
  meetingId: string;
  eventTitle: string;
  onClose: () => void;
  onSent: () => void;
}

export function EventBlastSheet({
  visible,
  meetingId,
  eventTitle,
  onClose,
  onSent,
}: EventBlastSheetProps) {
  const { colors } = useTheme();
  const [message, setMessage] = useState("");
  const [pushEnabled, setPushEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const initiateBlast = useAuthenticatedMutation(api.functions.eventBlasts.initiate);

  const handleSend = async () => {
    if (!message.trim()) {
      Alert.alert("Empty Message", "Please enter a message to send.");
      return;
    }

    const channels: string[] = [];
    if (pushEnabled) channels.push("push");
    if (smsEnabled) channels.push("sms");

    if (channels.length === 0) {
      Alert.alert("No Channel", "Please select at least one channel (Push or SMS).");
      return;
    }

    Alert.alert(
      "Send Message",
      `Send this message to all attendees via ${channels.join(" & ")}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: async () => {
            setIsSending(true);
            try {
              await initiateBlast({
                meetingId: meetingId as Id<"meetings">,
                message: message.trim(),
                channels,
              });
              setMessage("");
              onSent();
              onClose();
            } catch (error) {
              Alert.alert("Error", "Failed to send message. Please try again.");
              console.error("Blast send error:", error);
            } finally {
              setIsSending(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={[styles.overlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={onClose}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={[styles.sheet, { backgroundColor: colors.surface }]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>
                Message Attendees
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Send a message to everyone going to {eventTitle}
              </Text>

              {/* Message Input */}
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="Type your message..."
                placeholderTextColor={colors.textSecondary}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
              <Text style={[styles.charCount, { color: colors.textSecondary }]}>
                {message.length}/500
              </Text>

              {/* Channel Selection */}
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                SEND VIA
              </Text>
              <View style={[styles.channelRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <View style={styles.channelInfo}>
                  <Ionicons name="notifications-outline" size={20} color={colors.text} />
                  <Text style={[styles.channelLabel, { color: colors.text }]}>
                    Push Notification
                  </Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={setPushEnabled}
                  trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }}
                />
              </View>
              <View style={[styles.channelRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <View style={styles.channelInfo}>
                  <Ionicons name="chatbubble-outline" size={20} color={colors.text} />
                  <Text style={[styles.channelLabel, { color: colors.text }]}>
                    SMS Text Message
                  </Text>
                </View>
                <Switch
                  value={smsEnabled}
                  onValueChange={setSmsEnabled}
                  trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }}
                />
              </View>

              {/* Send Button */}
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: DEFAULT_PRIMARY_COLOR },
                  isSending && styles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={isSending || !message.trim()}
              >
                {isSending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendButtonText}>Send Message</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  body: {
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    minHeight: 100,
  },
  charCount: {
    fontSize: 12,
    textAlign: "right",
    marginTop: 4,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  channelInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  channelLabel: {
    fontSize: 16,
  },
  sendButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
