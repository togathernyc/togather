/**
 * Legacy Chat ID Route (Backwards Compatibility)
 *
 * Route: /inbox/[chat_id]
 *
 * This route provides backwards compatibility for legacy URLs that use
 * channelId directly. It queries the channel to get groupId and slug,
 * then redirects to the new URL format: /inbox/[groupId]/[channelSlug]
 *
 * Supported chat_id formats:
 * - Convex channel ID (e.g., "k17abc123xyz") - queries channel data and redirects
 * - Stream channel ID (e.g., "prod_k17abc123_main") - parses and redirects
 * - Group ID (e.g., "k17abc123") - redirects to /inbox/[groupId]/general
 *
 * Error handling:
 * - If channel lookup fails and the ID can't be validated as a group, redirects to inbox
 * - Prevents perpetual loading states for deleted/inaccessible channels
 */
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { parseStreamChannelId } from "@togather/shared";
import type { Id } from "@services/api/convex";

export default function LegacyChatIdRoute() {
  const { chat_id, groupId: groupIdParam } = useLocalSearchParams<{
    chat_id: string;
    groupId?: string;
  }>();
  const router = useRouter();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [showError, setShowError] = useState(false);

  // Determine if chat_id is a Convex channel ID vs Stream channel ID or group ID
  // Convex IDs are base64url encoded (typically start with letters, no underscores)
  // Stream channel IDs have format like "prod_123" or "staging_456" (with underscores)
  const isConvexChannelId =
    chat_id &&
    !chat_id.includes("_") && // Stream IDs have underscores
    chat_id.length > 10; // Convex IDs are longer

  // Try to parse as Stream channel ID
  const parsedChannel = !isConvexChannelId && chat_id
    ? parseStreamChannelId(chat_id)
    : null;

  // Query channel data if we have a Convex channel ID
  const channelData = useQuery(
    api.functions.messaging.channels.getChannel,
    isConvexChannelId && token
      ? { token, channelId: chat_id as Id<"chatChannels"> }
      : "skip"
  );

  // When channel lookup fails, we try treating the ID as a group ID.
  // Query to validate if it's actually a valid group before redirecting.
  // This prevents perpetual loading states for deleted/inaccessible channels.
  const potentialGroupId = isConvexChannelId && channelData === null ? chat_id : null;
  const groupValidation = useQuery(
    api.functions.groups.index.getById,
    potentialGroupId
      ? { groupId: potentialGroupId as Id<"groups">, token: token || undefined }
      : "skip"
  );

  useEffect(() => {
    // If we have parsed Stream channel ID with groupId (can determine type locally)
    if (parsedChannel?.groupId) {
      // Map channel type to slug: "main" -> "general", "leaders" -> "leaders"
      const channelSlug = parsedChannel.type === "leaders" ? "leaders" : "general";
      router.replace(`/inbox/${parsedChannel.groupId}/${channelSlug}`);
      return;
    }

    // If we have channel data from Convex query (use slug if available, fallback to type)
    if (channelData?.groupId) {
      // Use slug from channel data, fallback to mapping channelType to slug
      const channelSlug = channelData.slug ?? (channelData.channelType === "leaders" ? "leaders" : "general");
      router.replace(`/inbox/${channelData.groupId}/${channelSlug}`);
      return;
    }

    // If groupIdParam is provided but chat_id is a Convex channel ID,
    // we need to wait for channelData to determine the correct channel type.
    // Only redirect immediately if we can't get channel type from query.
    if (groupIdParam) {
      // If it's a Convex channel ID, wait for channel data to get the type
      if (isConvexChannelId) {
        // channelData is undefined = still loading, null = not found
        if (channelData === undefined) {
          return; // Wait for channel query
        }
        // If we got channel data, it would have been handled above
        // If channelData is null (not found), fall through to default
      }
      // Stream channel IDs are already handled by parsedChannel above
      // Fall back to general for non-channel IDs or when channel lookup failed
      router.replace(`/inbox/${groupIdParam}/general`);
      return;
    }

    // Handle failed Convex channel lookup - channelData is null (query completed but found nothing)
    // This could mean: 1) channel doesn't exist, 2) user lacks access, or 3) it's actually a group ID
    // Since Convex group IDs and channel IDs use the same format, we validate the group exists.
    if (isConvexChannelId && channelData === null) {
      // Wait for group validation query
      if (groupValidation === undefined) {
        // Still loading validation
        return;
      }
      if (groupValidation !== null) {
        // Group exists - redirect to it
        router.replace(`/inbox/${chat_id}/general`);
        return;
      }
      // Group doesn't exist either - show error state
      setShowError(true);
      return;
    }

    // If chat_id looks like a group ID (not a channel ID), redirect to general
    // This handles the case where navigation passes a group ID as chat_id
    if (chat_id && !isConvexChannelId && !parsedChannel) {
      router.replace(`/inbox/${chat_id}/general`);
      return;
    }
  }, [
    chat_id,
    groupIdParam,
    parsedChannel,
    channelData,
    groupValidation,
    isConvexChannelId,
    router,
  ]);

  // Handle navigation to inbox when chat is not found
  const handleGoToInbox = () => {
    router.replace("/(tabs)/chat");
  };

  // Show error state when chat is not found
  if (showError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <Text style={[styles.errorTitle, { color: colors.text }]}>Chat Not Found</Text>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          This chat may have been deleted or you no longer have access to it.
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: primaryColor }]}
          onPress={handleGoToInbox}
        >
          <Text style={[styles.buttonText, { color: '#ffffff' }]}>Go to Inbox</Text>
        </Pressable>
      </View>
    );
  }

  // Show loading state while resolving
  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <ActivityIndicator size="large" color={primaryColor} />
      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading chat...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
