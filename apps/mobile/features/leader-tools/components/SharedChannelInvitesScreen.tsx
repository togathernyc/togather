import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { format } from "date-fns";
import { useRespondToChannelInvite } from "@features/groups/hooks/useRespondToChannelInvite";

export function SharedChannelInvitesScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();

  // Queries
  const pendingInvites = useQuery(
    api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
    token && group_id
      ? { token, groupId: group_id as Id<"groups"> }
      : "skip"
  );

  const activeChannels = useQuery(
    api.functions.messaging.sharedChannels.listActiveSharedChannelsForGroup,
    token && group_id
      ? { token, groupId: group_id as Id<"groups"> }
      : "skip"
  );

  const { respondingTo, handleRespond } = useRespondToChannelInvite({
    token,
    groupId: group_id ?? "",
  });

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const isLoading =
    pendingInvites === undefined || activeChannels === undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shared Channels</Text>
        <View style={styles.headerRight} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
        >
          {/* Pending Invitations Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PENDING INVITATIONS</Text>
            {pendingInvites && pendingInvites.length > 0 ? (
              pendingInvites.map((invite) => (
                <View key={invite.channelId} style={styles.inviteCard}>
                  <View style={styles.inviteInfo}>
                    <View style={styles.inviteHeader}>
                      <Ionicons name="link" size={16} color="#8B5CF6" />
                      <Text
                        style={styles.inviteChannelName}
                        numberOfLines={1}
                      >
                        #{invite.channelName}
                      </Text>
                    </View>
                    <Text style={styles.inviteDetail}>
                      From {invite.primaryGroupName}
                    </Text>
                    <Text style={styles.inviteDetail}>
                      Invited by {invite.invitedByName} {"\u00B7"}{" "}
                      {format(
                        new Date(invite.invitedAt),
                        "MMM d, yyyy"
                      )}
                    </Text>
                  </View>
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={[
                        styles.acceptButton,
                        { backgroundColor: primaryColor },
                      ]}
                      onPress={() =>
                        handleRespond(invite.channelId, "accepted")
                      }
                      disabled={respondingTo !== null}
                    >
                      {respondingTo ===
                      `${invite.channelId}-accept` ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.acceptButtonText}>
                          Accept
                        </Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={() =>
                        handleRespond(invite.channelId, "declined")
                      }
                      disabled={respondingTo !== null}
                    >
                      {respondingTo ===
                      `${invite.channelId}-decline` ? (
                        <ActivityIndicator
                          size="small"
                          color="#FF3B30"
                        />
                      ) : (
                        <Text style={styles.declineButtonText}>
                          Decline
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>
                  No pending invitations
                </Text>
              </View>
            )}
          </View>

          {/* Active Shared Channels Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              ACTIVE SHARED CHANNELS
            </Text>
            {activeChannels && activeChannels.length > 0 ? (
              activeChannels.map((channel) => (
                <View key={channel.channelId} style={styles.activeCard}>
                  <View style={styles.activeInfo}>
                    <View style={styles.inviteHeader}>
                      <Ionicons
                        name="link"
                        size={16}
                        color="#22C55E"
                      />
                      <Text
                        style={styles.activeChannelName}
                        numberOfLines={1}
                      >
                        #{channel.channelName}
                      </Text>
                    </View>
                    <Text style={styles.inviteDetail}>
                      From {channel.primaryGroupName}
                    </Text>
                    <Text style={styles.inviteDetail}>
                      {channel.memberCount} member
                      {channel.memberCount !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View
                    style={[styles.statusBadge, styles.activeBadge]}
                  >
                    <Text style={styles.activeBadgeText}>
                      Connected
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>
                  No active shared channels
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    marginHorizontal: 8,
  },
  headerRight: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  inviteCard: {
    backgroundColor: "#F5F0FF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E0D6F5",
  },
  inviteInfo: {
    marginBottom: 12,
  },
  inviteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  inviteChannelName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#5B21B6",
    flexShrink: 1,
  },
  inviteDetail: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  inviteActions: {
    flexDirection: "row",
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  declineButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF3B30",
    alignItems: "center",
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF3B30",
  },
  activeCard: {
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    flexDirection: "row",
    alignItems: "center",
  },
  activeInfo: {
    flex: 1,
  },
  activeChannelName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#166534",
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  activeBadge: {
    backgroundColor: "#DCFCE7",
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#166534",
  },
  emptySection: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptySectionText: {
    fontSize: 14,
    color: "#999",
  },
});
