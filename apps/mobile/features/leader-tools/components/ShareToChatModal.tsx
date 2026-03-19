import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { CustomModal } from "@components/ui/Modal";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";

interface ShareToChatModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (message: string) => void;
  onSkip: () => void;
  isLoading?: boolean;
  eventTitle?: string;
}

const DEFAULT_MESSAGE = "Can't wait to see you all there! Please RSVP";

export function ShareToChatModal({
  visible,
  onClose,
  onSend,
  onSkip,
  isLoading = false,
  eventTitle,
}: ShareToChatModalProps) {
  const { colors } = useTheme();
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  const handleSend = () => {
    onSend(message.trim() || DEFAULT_MESSAGE);
  };

  const handleSkip = () => {
    onSkip();
  };

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title="Share to Group Chat"
      withoutCloseBtn={isLoading}
    >
      <View style={styles.container}>
        <Text style={styles.description}>
          Add a personal message to share this event with your group. A personalized message helps engage your members!
        </Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Write a message..."
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isLoading}
            maxLength={500}
          />
          <Text style={styles.charCount}>{message.length}/500</Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            disabled={isLoading}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.sendButtonText}>Send to Chat</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          You can always share the event later by pasting the link in the chat.
        </Text>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  description: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  inputContainer: {
    position: "relative",
  },
  input: {
    borderWidth: 2,
    borderColor: "#ecedf0",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: "#fff",
    fontSize: 16,
    color: "#333",
    minHeight: 100,
  },
  charCount: {
    position: "absolute",
    bottom: 8,
    right: 12,
    fontSize: 12,
    color: "#999",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  skipButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  skipButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "500",
  },
  sendButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  hint: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    fontStyle: "italic",
  },
});
