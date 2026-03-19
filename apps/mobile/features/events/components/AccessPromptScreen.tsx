import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";

interface AccessPrompt {
  type: "sign_in" | "join_community" | "request_group";
  message: string;
  communityId?: string;
  groupId?: string;
}

interface EventPreview {
  shortId: string;
  title: string | null;
  scheduledAt: string;
  coverImage: string | null;
  groupName: string;
  communityName: string;
  communityLogo: string | null;
}

interface AccessPromptScreenProps {
  event: EventPreview;
  prompt: AccessPrompt;
}

/**
 * AccessPromptScreen - Shows when user doesn't have access to a restricted event
 *
 * Displays event preview with basic info and prompts user to take action
 * (sign in, join community, or request group access) to see full details.
 */
export function AccessPromptScreen({ event, prompt }: AccessPromptScreenProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const eventDate = event.scheduledAt ? parseISO(event.scheduledAt) : null;

  const handleAction = () => {
    switch (prompt.type) {
      case "sign_in":
        router.push("/(auth)/signin");
        break;
      case "join_community":
        if (prompt.communityId) {
          // Navigate to community page - adjust route as needed
          router.push(`/communities/${prompt.communityId}` as any);
        }
        break;
      case "request_group":
        if (prompt.groupId) {
          // Navigate to group page - adjust route as needed
          router.push(`/groups/${prompt.groupId}` as any);
        }
        break;
    }
  };

  const getActionButtonText = () => {
    switch (prompt.type) {
      case "sign_in":
        return "Sign In";
      case "join_community":
        return "Join Community";
      case "request_group":
        return "Request to Join";
      default:
        return "Continue";
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.surface }]} contentContainerStyle={styles.scrollContent}>
      {/* Cover Image with overlay */}
      <View style={styles.coverContainer}>
        <AppImage
          source={event.coverImage}
          style={styles.coverImage}
          resizeMode="cover"
          placeholder={{
            type: "icon",
            icon: "calendar-outline",
            iconSize: 64,
            iconColor: "#ccc",
          }}
        />
        <View style={styles.coverOverlay} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Event Title */}
        <Text style={[styles.title, { color: colors.text }]}>{event.title || "Event"}</Text>

        {/* Date */}
        {eventDate && (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              {format(eventDate, "EEEE, MMMM d, yyyy 'at' h:mm a")}
            </Text>
          </View>
        )}

        {/* Community/Group Info */}
        <View style={[styles.organizerCard, { backgroundColor: colors.surfaceSecondary }]}>
          <AppImage
            source={event.communityLogo}
            style={styles.communityLogo}
            resizeMode="cover"
            placeholder={{
              type: "initials",
              name: event.communityName,
            }}
          />
          <View style={styles.organizerInfo}>
            <Text style={[styles.organizerLabel, { color: colors.textSecondary }]}>Hosted by</Text>
            <Text style={[styles.organizerName, { color: colors.text }]}>{event.groupName}</Text>
            <Text style={[styles.communityName, { color: colors.textSecondary }]}>{event.communityName}</Text>
          </View>
        </View>

        {/* Access Prompt */}
        <View style={styles.promptCard}>
          <View style={[styles.promptIconContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="lock-closed" size={24} color={DEFAULT_PRIMARY_COLOR} />
          </View>
          <Text style={[styles.promptTitle, { color: colors.text }]}>Access Required</Text>
          <Text style={[styles.promptMessage, { color: colors.textSecondary }]}>{prompt.message}</Text>
        </View>

        {/* Action Button */}
        <TouchableOpacity style={styles.actionButton} onPress={handleAction}>
          <Text style={styles.actionButtonText}>{getActionButtonText()}</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
        </TouchableOpacity>

        {/* Info Text */}
        <Text style={[styles.infoFooter, { color: colors.textTertiary }]}>
          Complete the required action to view full event details and RSVP
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  coverContainer: {
    position: "relative",
    width: "100%",
    height: 240,
  },
  coverImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#f0f0f0",
  },
  coverImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  coverOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  infoText: {
    fontSize: 15,
    flex: 1,
  },
  organizerCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  communityLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e0e0e0",
  },
  organizerInfo: {
    flex: 1,
  },
  organizerLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  organizerName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  communityName: {
    fontSize: 14,
  },
  promptCard: {
    backgroundColor: "#F8F0FF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#E5D4FF",
  },
  promptIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  promptTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  promptMessage: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  actionButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  infoFooter: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
