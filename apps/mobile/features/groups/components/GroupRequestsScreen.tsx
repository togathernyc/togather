/**
 * GroupRequestsScreen
 *
 * The leaders' (and admins') surface for reviewing pending join requests for a
 * single group. Reached from the "Requests" row on the group page and from the
 * incoming-request push notification (deep link /groups/[group_id]/requests).
 *
 * Each requester renders a rich card — profile + contact actions (message in
 * Togather / call / text / copy number), the groups they already belong to, an
 * expandable request history, and accept/decline buttons. The accept/decline
 * mutation and the underlying authorization (community admins always; group
 * leaders only when the group's approval mode is "leaders") live in
 * `groupMembers.reviewGroupJoinRequest`.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Alert,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { formatDistanceToNow } from "date-fns";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useStartDirectMessage } from "@features/chat/hooks/useStartDirectMessage";
import { formatError } from "@/utils/error-handling";

interface RequestHistoryEntry {
  groupId: Id<"groups">;
  groupName: string;
  groupTypeName: string;
  status: string;
  requestedAt: number;
  reviewedAt: number | null;
}

interface GroupJoinRequest {
  membershipId: Id<"groupMembers">;
  requestedAt: number;
  user: {
    id: Id<"users">;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    profilePhoto: string | null;
  } | null;
  currentMemberships: Array<{
    groupId: Id<"groups">;
    groupName: string;
    groupTypeName: string;
    role: string;
  }>;
  membershipCountsByType: Record<string, number>;
  requestHistory: RequestHistoryEntry[];
}

function formatDate(date: number | null): string {
  if (!date) return "";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "";
  }
}

// Small status pill reused for the history rows.
function StatusBadge({ status }: { status: string }) {
  let color = "#999";
  if (status === "pending") color = "#FF9800";
  else if (status === "declined") color = "#FF6B6B";
  else if (status === "accepted" || status === "approved") color = "#4CAF50";

  return (
    <View style={[styles.statusBadge, { backgroundColor: color + "20" }]}>
      <Text style={[styles.statusBadgeText, { color }]}>{status || "unknown"}</Text>
    </View>
  );
}

interface RequestCardProps {
  request: GroupJoinRequest;
  primaryColor: string;
  isProcessing: boolean;
  onAccept: (r: GroupJoinRequest) => void;
  onDecline: (r: GroupJoinRequest) => void;
}

function RequestCard({
  request,
  primaryColor,
  isProcessing,
  onAccept,
  onDecline,
}: RequestCardProps) {
  const { colors } = useTheme();
  const { messageUser, isStarting } = useStartDirectMessage();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const user = request.user;
  if (!user) return null;

  const userName = `${user.firstName} ${user.lastName}`.trim();
  const hasMemberships = request.currentMemberships.length > 0;
  const membershipSummary = Object.entries(request.membershipCountsByType)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");

  const copyPhone = async () => {
    if (!user.phone) return;
    await Clipboard.setStringAsync(user.phone);
    Alert.alert("Copied", `${user.phone} copied to clipboard.`);
  };

  return (
    <View style={[styles.userCard, { backgroundColor: colors.surface }]}>
      {/* Header: avatar + name + membership summary */}
      <View style={styles.userHeader}>
        <View style={styles.userAvatar}>
          {user.profilePhoto ? (
            <Image source={{ uri: user.profilePhoto }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
              <Text style={styles.avatarInitials}>
                {user.firstName?.[0]}
                {user.lastName?.[0]}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>{userName}</Text>
          {!!user.email && (
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
              {user.email}
            </Text>
          )}
          <Text style={[styles.requestDate, { color: colors.textTertiary }]}>
            Requested {formatDate(request.requestedAt)}
          </Text>
          {hasMemberships && (
            <Text style={[styles.membershipSummary, { color: primaryColor }]}>
              Member of: {membershipSummary}
            </Text>
          )}
        </View>
      </View>

      {/* Contact actions */}
      <View style={[styles.contactRow, { borderTopColor: colors.borderLight }]}>
        <TouchableOpacity
          style={styles.contactButton}
          onPress={() =>
            messageUser({
              otherUserId: user.id,
              firstName: user.firstName,
              displayName: userName,
              profilePhoto: user.profilePhoto,
            })
          }
          disabled={isStarting}
        >
          <Ionicons name="chatbubble-outline" size={18} color={primaryColor} />
          <Text style={[styles.contactButtonText, { color: primaryColor }]}>Message</Text>
        </TouchableOpacity>

        {!!user.phone && (
          <>
            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => Linking.openURL(`tel:${user.phone}`)}
            >
              <Ionicons name="call-outline" size={18} color={primaryColor} />
              <Text style={[styles.contactButtonText, { color: primaryColor }]}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.contactButton}
              onPress={() => Linking.openURL(`sms:${user.phone}`)}
            >
              <Ionicons name="mail-outline" size={18} color={primaryColor} />
              <Text style={[styles.contactButtonText, { color: primaryColor }]}>Text</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactButton} onPress={copyPhone}>
              <Ionicons name="copy-outline" size={18} color={primaryColor} />
              <Text style={[styles.contactButtonText, { color: primaryColor }]}>
                Copy #
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Request history (collapsible) */}
      {request.requestHistory.length > 0 && (
        <>
          <TouchableOpacity
            style={[styles.historyButton, { borderTopColor: colors.borderLight }]}
            onPress={() => setHistoryExpanded((v) => !v)}
          >
            <Ionicons name="time-outline" size={16} color={primaryColor} />
            <Text style={[styles.historyButtonText, { color: primaryColor }]}>
              {historyExpanded ? "Hide history" : "View request history"}
            </Text>
            <Ionicons
              name={historyExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={primaryColor}
            />
          </TouchableOpacity>
          {historyExpanded && (
            <View style={[styles.historyList, { borderTopColor: colors.borderLight }]}>
              {request.requestHistory.map((h, i) => (
                <View
                  key={`${h.groupId}-${i}`}
                  style={[styles.historyItem, { borderBottomColor: colors.borderLight }]}
                >
                  <View style={styles.historyInfo}>
                    <Text style={[styles.groupName, { color: colors.text }]}>
                      {h.groupName}
                    </Text>
                    {!!h.groupTypeName && (
                      <Text style={[styles.groupType, { color: colors.textSecondary }]}>
                        {h.groupTypeName}
                      </Text>
                    )}
                    <Text style={[styles.requestDate, { color: colors.textTertiary }]}>
                      {formatDate(h.requestedAt)}
                    </Text>
                  </View>
                  <StatusBadge status={h.status} />
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Accept / decline */}
      <View style={[styles.decisionRow, { borderTopColor: colors.borderLight }]}>
        <TouchableOpacity
          style={[styles.decisionButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => onDecline(request)}
          disabled={isProcessing}
        >
          <Ionicons name="close" size={18} color={colors.destructive} />
          <Text style={[styles.decisionText, { color: colors.destructive }]}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.decisionButton, { backgroundColor: `${primaryColor}20` }]}
          onPress={() => onAccept(request)}
          disabled={isProcessing}
        >
          <Ionicons name="checkmark" size={18} color={primaryColor} />
          <Text style={[styles.decisionText, { color: primaryColor }]}>Approve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function GroupRequestsScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();

  const requests = useAuthenticatedQuery(
    api.functions.groupMembers.listGroupJoinRequests,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip",
  ) as GroupJoinRequest[] | undefined;

  const reviewRequest = useAuthenticatedMutation(
    api.functions.groupMembers.reviewGroupJoinRequest,
  );

  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (group_id) {
      router.push(`/groups/${group_id}`);
    }
  };

  const review = useCallback(
    async (request: GroupJoinRequest, action: "accept" | "decline") => {
      if (!group_id) return;
      setProcessingId(String(request.membershipId));
      try {
        await reviewRequest({
          groupId: group_id as Id<"groups">,
          membershipId: request.membershipId,
          action,
        });
      } catch (error) {
        Alert.alert(
          "Couldn't update request",
          formatError(error, "Failed to update the request. Please try again."),
        );
      } finally {
        setProcessingId(null);
      }
    },
    [group_id, reviewRequest],
  );

  const handleAccept = useCallback(
    (request: GroupJoinRequest) => review(request, "accept"),
    [review],
  );

  const handleDecline = useCallback(
    (request: GroupJoinRequest) => {
      const name = request.user
        ? `${request.user.firstName} ${request.user.lastName}`.trim()
        : "this person";
      Alert.alert(
        "Decline request?",
        `Decline ${name}'s request to join?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Decline",
            style: "destructive",
            onPress: () => review(request, "decline"),
          },
        ],
      );
    },
    [review],
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary },
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Requests</Text>
        <View style={styles.headerSpacer} />
      </View>

      {requests === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator color={primaryColor} />
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-done-outline" size={40} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No pending requests
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {requests.map((request) => (
            <RequestCard
              key={String(request.membershipId)}
              request={request}
              primaryColor={primaryColor}
              isProcessing={processingId === String(request.membershipId)}
              onAccept={handleAccept}
              onDecline={handleDecline}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginRight: 32,
  },
  headerSpacer: { width: 32 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: 24,
  },
  emptyText: { fontSize: 15 },
  scrollContent: { padding: 16, gap: 16 },
  userCard: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  userAvatar: { width: 48, height: 48, borderRadius: 24, overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: "600" },
  userEmail: { fontSize: 13, marginTop: 2 },
  membershipSummary: { fontSize: 12, marginTop: 4 },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  contactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  contactButtonText: { fontSize: 13, fontWeight: "500" },
  historyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  historyButtonText: { fontSize: 13, fontWeight: "500" },
  historyList: { borderTopWidth: 1 },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
  },
  historyInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: "500" },
  groupType: { fontSize: 12, marginTop: 2 },
  requestDate: { fontSize: 11, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  decisionRow: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderTopWidth: 1,
  },
  decisionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  decisionText: { fontSize: 15, fontWeight: "600" },
});
