"use client";

/**
 * Channel Invite Page Client
 *
 * Displays channel info from an invite link and provides CTA actions:
 * - Not authenticated: "Sign up to join"
 * - Not group member: "Join {group} first" -> links to group page
 * - Already channel member: "Open Channel"
 * - Open mode: "Join Channel" -> calls joinViaInviteLink
 * - Approval mode + no pending: "Request to Join"
 * - Approval mode + pending: "Request Pending" (disabled) + "Cancel Request"
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@providers/AuthProvider";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

export default function ChannelInvitePageClient() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();

  const [isJoining, setIsJoining] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Load auth token from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem("auth_token").then(setAuthToken);
  }, []);

  // Fetch channel info by invite short ID
  const channelData = useQuery(
    api.functions.messaging.channelInvites.getByShortId,
    shortId ? { shortId, token: authToken ?? undefined } : "skip"
  );

  const isLoading = channelData === undefined;
  const error = channelData === null;

  // Mutations
  const joinViaInviteLink = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.joinViaInviteLink
  );
  const cancelJoinRequest = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.cancelJoinRequest
  );

  // On web, hide back button when there's no navigation history (direct link)
  const showBackButton = Platform.OS !== "web" || router.canGoBack();

  // Handle back navigation
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/search");
    }
  };

  // Navigate to auth
  const navigateToAuth = () => {
    router.push("/(auth)/signin");
  };

  // Handle join channel
  const handleJoin = async () => {
    if (!shortId) return;

    setIsJoining(true);
    try {
      const result = await joinViaInviteLink({ shortId });

      if (result.joined && result.groupId && result.channelSlug) {
        // Navigate to the channel
        router.replace(`/inbox/${result.groupId}/${result.channelSlug}` as any);
      } else if (result.requested) {
        Alert.alert(
          "Request Sent",
          "Your request to join this channel has been sent. A group leader will review it."
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to join channel");
    } finally {
      setIsJoining(false);
    }
  };

  // Handle cancel join request
  const handleCancelRequest = async () => {
    if (!channelData?.channelId) return;

    setIsCancelling(true);
    try {
      await cancelJoinRequest({ channelId: channelData.channelId });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to cancel request");
    } finally {
      setIsCancelling(false);
    }
  };

  // Handle navigate to channel (already a member)
  const handleOpenChannel = () => {
    if (channelData?.groupId && channelData?.channelSlug) {
      router.push(`/inbox/${channelData.groupId}/${channelData.channelSlug}` as any);
    }
  };

  // Handle navigate to group page (not a group member)
  const handleJoinGroup = () => {
    if (channelData?.groupShortId) {
      router.push(`/g/${channelData.groupShortId}`);
    }
  };

  // ============================================================================
  // Render States
  // ============================================================================

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading channel...
        </Text>
      </SafeAreaView>
    );
  }

  if (error || !channelData) {
    return (
      <SafeAreaView style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textTertiary} />
        <Text style={[styles.errorTitle, { color: colors.text }]}>Channel Not Found</Text>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
          This invite link may have been disabled or the channel no longer exists.
        </Text>
        <TouchableOpacity style={[styles.backButtonCta, { backgroundColor: primaryColor }]} onPress={handleBack}>
          <Text style={styles.backButtonCtaText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // CTA Button Logic
  // ============================================================================

  const renderCTA = () => {
    const { userStatus, joinMode, groupName, groupShortId } = channelData;

    switch (userStatus) {
      case "not_authenticated":
        return (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            onPress={navigateToAuth}
          >
            <Text style={styles.primaryButtonText}>Sign Up to Join</Text>
          </TouchableOpacity>
        );

      case "not_group_member":
        return (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            onPress={handleJoinGroup}
          >
            <Text style={styles.primaryButtonText}>
              Join {groupName || "Group"} First
            </Text>
          </TouchableOpacity>
        );

      case "already_member":
        return (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            onPress={handleOpenChannel}
          >
            <Text style={styles.primaryButtonText}>Open Channel</Text>
          </TouchableOpacity>
        );

      case "pending_request":
        return (
          <View>
            <View style={styles.pendingContainer}>
              <Ionicons name="time-outline" size={20} color="#FF9500" />
              <Text style={styles.pendingText}>Request Pending</Text>
            </View>
            <TouchableOpacity
              style={[styles.secondaryButton, isCancelling && styles.buttonDisabled]}
              onPress={handleCancelRequest}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                  Cancel Request
                </Text>
              )}
            </TouchableOpacity>
          </View>
        );

      case "eligible":
        if (joinMode === "open") {
          return (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, isJoining && styles.buttonDisabled]}
              onPress={handleJoin}
              disabled={isJoining}
            >
              {isJoining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Join Channel</Text>
              )}
            </TouchableOpacity>
          );
        } else {
          // approval_required
          return (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, isJoining && styles.buttonDisabled]}
              onPress={handleJoin}
              disabled={isJoining}
            >
              {isJoining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Request to Join</Text>
              )}
            </TouchableOpacity>
          );
        }

      default:
        return null;
    }
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with back button */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {showBackButton ? (
          <TouchableOpacity style={styles.headerButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={{ width: 40 }} />
      </View>

      {/* Center content */}
      <View style={styles.centerContent}>
        {/* Channel icon */}
        <View style={[styles.channelIconContainer, { backgroundColor: primaryColor + "20" }]}>
          <Ionicons name="chatbubble" size={48} color={primaryColor} />
        </View>

        {/* Channel name */}
        <Text style={[styles.channelName, { color: colors.text }]}>
          #{channelData.channelName}
        </Text>

        {/* Group name */}
        {channelData.groupName && (
          <Text style={[styles.groupName, { color: colors.textSecondary }]}>
            {channelData.groupName}
          </Text>
        )}

        {/* Community name */}
        {channelData.communityName && (
          <Text style={[styles.communityName, { color: colors.textTertiary }]}>
            {channelData.communityName}
          </Text>
        )}

        {/* Member count */}
        <View style={styles.memberRow}>
          <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.memberText, { color: colors.textSecondary }]}>
            {channelData.memberCount} {channelData.memberCount === 1 ? "member" : "members"}
          </Text>
        </View>

        {/* Join mode badge */}
        <View style={[styles.modeBadge, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons
            name={channelData.joinMode === "open" ? "globe-outline" : "lock-closed-outline"}
            size={14}
            color={colors.textSecondary}
          />
          <Text style={[styles.modeBadgeText, { color: colors.textSecondary }]}>
            {channelData.joinMode === "open" ? "Open Channel" : "Approval Required"}
          </Text>
        </View>

        {/* Description */}
        {channelData.channelDescription && (
          <Text style={[styles.description, { color: colors.text }]}>
            {channelData.channelDescription}
          </Text>
        )}
      </View>

      {/* Bottom Action Button */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + 16,
            backgroundColor: colors.surface,
            borderTopColor: colors.surfaceSecondary,
          },
        ]}
      >
        {renderCTA()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    marginTop: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 8,
  },
  backButtonCta: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonCtaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  channelIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  channelName: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  groupName: {
    fontSize: 18,
    fontWeight: "500",
    marginBottom: 4,
    textAlign: "center",
  },
  communityName: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  memberText: {
    fontSize: 14,
    marginLeft: 6,
  },
  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 16,
  },
  modeBadgeText: {
    fontSize: 13,
    fontWeight: "500",
    marginLeft: 6,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  pendingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF3E0",
    paddingVertical: 16,
    borderRadius: 12,
  },
  pendingText: {
    fontSize: 16,
    color: "#FF9500",
    fontWeight: "600",
    marginLeft: 8,
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
