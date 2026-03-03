import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { format, isToday, isThisWeek, parseISO } from "date-fns";
import type { ChatRoom } from "@/types/shared";

interface MessagesSectionProps {
  chatRooms: ChatRoom[];
}

export function MessagesSection({ chatRooms }: MessagesSectionProps) {
  const router = useRouter();
  const { user, community } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const formatMessageDate = (dateString: string) => {
    const date = parseISO(dateString);
    if (isToday(date)) {
      return format(date, "hh:mm a");
    } else if (isThisWeek(date)) {
      return format(date, "MMM dd");
    } else {
      return format(date, "MMM dd, yyyy");
    }
  };

  const getSenderName = (chatRoom: ChatRoom) => {
    if (chatRoom.type === 7) {
      // COMMUNITY_BROADCAST type
      return community?.name || "Community";
    }
    return `${chatRoom.last_sender?.first_name || ""} ${chatRoom.last_sender?.last_name || ""}`.trim();
  };

  const getAvatarText = (chatRoom: ChatRoom) => {
    if (chatRoom.type === 7) {
      return community?.name?.[0] || "C";
    }
    // Compare as strings since user.id is now a Convex ID string
    const otherUsers = (chatRoom.users ?? []).filter((u) => String(u.id) !== String(user?.id));
    if (otherUsers.length === 1) {
      return (
        otherUsers[0].first_name?.[0] || otherUsers[0].last_name?.[0] || "U"
      );
    }
    if (otherUsers.length > 1) {
      return otherUsers
        .slice(0, 2)
        .map((u) => u.first_name?.[0] || "U")
        .join("");
    }
    return user?.first_name?.[0] || "U";
  };

  if (chatRooms.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NEW MESSAGES</Text>
      <View style={styles.messagesList}>
        {chatRooms.slice(0, 3).map((chatRoom) => (
          <TouchableOpacity
            key={chatRoom.id}
            style={styles.messageItem}
            onPress={() => chatRoom.id && router.push(`/inbox/${chatRoom.id}` as any)}
          >
            <View style={styles.avatarContainer}>
              <View style={[styles.avatar, { backgroundColor: primaryColor }]}>
                <Text style={styles.avatarText}>{getAvatarText(chatRoom)}</Text>
              </View>
              {!chatRoom.is_read && <View style={[styles.unreadDot, { backgroundColor: primaryColor }]} />}
            </View>
            <View style={styles.messageContent}>
              <Text style={styles.senderName}>{getSenderName(chatRoom)}</Text>
              <View style={styles.messageRow}>
                <Text style={styles.messageText} numberOfLines={1}>
                  {chatRoom.last_message_text}
                </Text>
                <Text style={styles.messageSeparator}>·</Text>
                <Text style={styles.messageDate}>
                  {chatRoom.last_message_at && formatMessageDate(chatRoom.last_message_at)}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#fff",
    marginTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  messagesList: {
    gap: 16,
  },
  messageItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  unreadDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
  },
  messageContent: {
    flex: 1,
  },
  senderName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  messageText: {
    fontSize: 14,
    color: "#666",
    flex: 1,
  },
  messageSeparator: {
    fontSize: 14,
    color: "#999",
  },
  messageDate: {
    fontSize: 14,
    color: "#666",
  },
});
