import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { parseISO } from "date-fns";
import { decodeEmoji } from "../utils/decodeEmoji";
import { formatChatDate } from "../utils/formatChatDate";
import type { Message } from "../types";

interface SystemMessageProps {
  message: Message;
}

/**
 * SystemMessage - Renders system metadata messages (e.g., "User joined the chat")
 * 
 * These messages are displayed centered with muted styling, different from regular chat bubbles.
 * Used for message_type === 3 (CHATROOM_JOIN) and other system events.
 */
export function SystemMessage({ message }: SystemMessageProps) {
  const decodedText = decodeEmoji(message.text || "");

  const messageDate = message.created_at || message.created_at_time || new Date();
  const dateObj =
    typeof messageDate === "string"
      ? parseISO(messageDate)
      : new Date(messageDate);

  const timestamp = formatChatDate(dateObj);

  // Only render if there's actual text content
  if (!decodedText || !String(decodedText).trim()) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{String(decodedText)}</Text>
      {timestamp && String(timestamp).trim() && (
        <Text style={styles.timestamp}>{String(timestamp)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    fontSize: 13,
    color: "#999",
    fontWeight: "500",
    textAlign: "center",
  },
  timestamp: {
    fontSize: 10,
    color: "#BBB",
    fontWeight: "400",
    textAlign: "center",
    marginTop: 4,
  },
});

