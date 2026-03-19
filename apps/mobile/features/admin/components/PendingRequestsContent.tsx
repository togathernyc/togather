/**
 * PendingRequestsContent - Content component for pending requests.
 *
 * Displays pending group join requests without header/safe area handling.
 * Used within AdminScreen's segmented control.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
  TextInput,
  Modal,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { useQuery, useMutation } from "@services/api/convex";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { GroupCreationRequestsContent } from "./GroupCreationRequestsContent";
import { formatError } from "@/utils/error-handling";

type RequestSubTab = "join" | "creation";

// Type definitions for Convex response (matching transformed snake_case data)
interface PendingJoinRequest {
  membership_id: Id<"groupMembers">;
  group_id: Id<"groups">;
  group_name: string;
  group_type: string;
  requested_at: number | null;
}

interface UserPendingRequests {
  user_id: Id<"users">;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  profile_photo: string | null;
  pending_requests: PendingJoinRequest[];
  current_memberships: Array<{
    group_id: Id<"groups">;
    group_name: string;
    group_type: string;
    role: string;
    joined_at: number;
  }>;
  membership_counts: {
    total: number;
    by_type: Record<string, number>;
  };
}

export function PendingRequestsContent() {
  const insets = useSafeAreaInsets();
  const { community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState<RequestSubTab>("join");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    membershipId: Id<"groupMembers">;
    userId: string;
    groupName: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  const communityId = community?.id as Id<"communities"> | undefined;

  // Fetch pending requests using Convex
  const rawPendingRequests = useQuery(
    api.functions.admin.requests.listPendingRequests,
    communityId && token ? { token, communityId } : "skip"
  );

  // Fetch creation requests for badge count
  const creationRequests = useQuery(
    api.functions.admin.requests.listGroupCreationRequests,
    communityId && token ? { token, communityId } : "skip"
  );

  const isLoading = rawPendingRequests === undefined;
  const isError = rawPendingRequests === null;

  // Transform Convex response to snake_case for compatibility
  const pendingRequests = rawPendingRequests?.map((item: any) => ({
    user_id: item.user.id,
    first_name: item.user.firstName,
    last_name: item.user.lastName,
    email: item.user.email,
    phone: item.user.phone,
    profile_photo: item.user.profilePhoto,
    pending_requests: item.pendingRequests.map((req: any) => ({
      membership_id: req.id,
      group_id: req.groupId,
      group_name: req.groupName,
      group_type: req.groupTypeName,
      requested_at: req.requestedAt,
    })),
    current_memberships: item.currentMemberships?.map((m: any) => ({
      group_id: m.groupId,
      group_name: m.groupName,
      group_type: m.groupTypeSlug,
      role: m.role,
      joined_at: m.joinedAt,
    })) || [],
    membership_counts: {
      total: Object.values(item.membershipCountsByType || {}).reduce((acc: number, val: any) => acc + (val as number), 0),
      by_type: item.membershipCountsByType || {},
    },
  }));

  // Find user info from pending requests for history modal
  const selectedUserInfo = selectedUserId
    ? pendingRequests?.find((u: any) => u.user_id === selectedUserId)
    : null;

  // Fetch user history when modal is open using Convex
  const rawUserHistoryData = useQuery(
    api.functions.admin.members.getUserGroupHistory,
    communityId && selectedUserId && showHistoryModal && token
      ? { token, communityId, targetUserId: selectedUserId as Id<"users"> }
      : "skip"
  );

  const isLoadingHistory = rawUserHistoryData === undefined && showHistoryModal && selectedUserId !== null;
  const isHistoryError = rawUserHistoryData === null;

  // Transform history data to snake_case
  const userHistoryData = rawUserHistoryData?.map((entry: any) => ({
    group_id: entry.groupId,
    group_name: entry.groupName,
    group_type_name: entry.groupTypeName,
    request_status: entry.requestStatus,
    is_active: !entry.leftAt && (entry.requestStatus === 'accepted' || !entry.requestStatus),
    requested_at: entry.requestedAt,
    joined_at: entry.joinedAt,
    left_at: entry.leftAt,
  }));

  // Combine user info with history
  const userHistory = selectedUserInfo && userHistoryData ? {
    first_name: selectedUserInfo.first_name,
    last_name: selectedUserInfo.last_name,
    email: selectedUserInfo.email || "",
    history: userHistoryData,
  } : null;

  // Review mutation using Convex
  const reviewPendingRequest = useMutation(api.functions.admin.requests.reviewPendingRequest);

  const handleReview = useCallback(async (membershipId: Id<"groupMembers">, action: "accept" | "decline", declineReasonText?: string) => {
    if (!communityId || !token) return;

    setIsReviewing(true);
    try {
      await reviewPendingRequest({
        token,
        communityId,
        membershipId,
        action,
        declineReason: declineReasonText,
      });
    } catch (error: any) {
      Alert.alert(
        "Error",
        formatError(error, "Failed to process request")
      );
    }
    setIsReviewing(false);
  }, [communityId, token, reviewPendingRequest]);

  const handleAccept = useCallback(
    (membershipId: Id<"groupMembers">, userName: string, groupName: string) => {
      Alert.alert(
        "Approve Request",
        `Allow ${userName} to join "${groupName}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Approve",
            onPress: () => handleReview(membershipId, "accept"),
          },
        ]
      );
    },
    [handleReview]
  );

  const handleDeclinePress = useCallback(
    (membershipId: Id<"groupMembers">, userId: string, groupName: string) => {
      setPendingAction({ membershipId, userId, groupName });
      setDeclineReason("");
      setShowDeclineModal(true);
    },
    []
  );

  const handleDeclineConfirm = useCallback(async () => {
    if (pendingAction) {
      await handleReview(
        pendingAction.membershipId,
        "decline",
        declineReason.trim() || undefined
      );
      setShowDeclineModal(false);
      setPendingAction(null);
    }
  }, [pendingAction, declineReason, handleReview]);

  const handleViewHistory = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setShowHistoryModal(true);
  }, []);

  const toggleExpanded = useCallback((userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Convex queries auto-refresh, just wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  }, []);

  const formatDate = (dateValue: number | string | null) => {
    if (!dateValue) return "Unknown";
    try {
      const date = typeof dateValue === "number" ? new Date(dateValue) : new Date(dateValue);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return String(dateValue);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading requests...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.errorText, { color: colors.error }]}>Failed to load requests</Text>
        <TouchableOpacity style={[styles.retryButton, { backgroundColor: primaryColor }]} onPress={handleRefresh}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEmpty = !pendingRequests || pendingRequests.length === 0;

  // Calculate badge counts
  const joinRequestsCount = pendingRequests
    ? pendingRequests.reduce((acc, u) => acc + u.pending_requests.length, 0)
    : 0;
  const creationRequestsCount = creationRequests ? creationRequests.length : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      {/* Sub-tab selector */}
      <View style={[styles.subTabContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === "join" && [styles.subTabActive, { borderBottomColor: primaryColor }],
          ]}
          onPress={() => setActiveSubTab("join")}
        >
          <Text
            style={[
              styles.subTabText,
              { color: colors.textSecondary },
              activeSubTab === "join" && [styles.subTabTextActive, { color: primaryColor }],
            ]}
          >
            Join
          </Text>
          {joinRequestsCount > 0 && (
            <View style={[styles.badge, { backgroundColor: primaryColor }]}>
              <Text style={styles.badgeText}>{joinRequestsCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === "creation" && [styles.subTabActive, { borderBottomColor: primaryColor }],
          ]}
          onPress={() => setActiveSubTab("creation")}
        >
          <Text
            style={[
              styles.subTabText,
              { color: colors.textSecondary },
              activeSubTab === "creation" && [styles.subTabTextActive, { color: primaryColor }],
            ]}
          >
            Creation
          </Text>
          {creationRequestsCount > 0 && (
            <View style={[styles.badge, { backgroundColor: primaryColor }]}>
              <Text style={styles.badgeText}>{creationRequestsCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content based on active sub-tab */}
      {activeSubTab === "creation" ? (
        <GroupCreationRequestsContent />
      ) : (
        <>
          {/* Summary */}
          <View style={[styles.summary, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
              {isEmpty
                ? "No pending requests"
                : `${pendingRequests.reduce((acc, u) => acc + u.pending_requests.length, 0)} requests from ${pendingRequests.length} people`}
            </Text>
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isEmpty && styles.emptyScrollContent,
        ]}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {isEmpty ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={64} color={primaryColor} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>All caught up!</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              There are no pending group join requests at this time.
            </Text>
          </View>
        ) : (
          pendingRequests.map((user) => (
            <UserRequestCard
              key={user.user_id}
              user={user}
              isExpanded={expandedUserId === user.user_id}
              onToggleExpand={() => toggleExpanded(user.user_id)}
              onAccept={handleAccept}
              onDecline={handleDeclinePress}
              onViewHistory={() => handleViewHistory(user.user_id)}
              formatDate={formatDate}
              isProcessing={isReviewing}
              primaryColor={primaryColor}
            />
          ))
        )}
      </ScrollView>

      {/* Decline Reason Modal */}
      <Modal
        visible={showDeclineModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeclineModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.modalBackground }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Decline Request</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
              Optionally provide a reason for declining.
            </Text>
            <TextInput
              style={[styles.reasonInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.inputPlaceholder}
              value={declineReason}
              onChangeText={setDeclineReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowDeclineModal(false)}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeclineButton, { backgroundColor: colors.destructive }]}
                onPress={handleDeclineConfirm}
              >
                <Text style={styles.modalDeclineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* User History Modal */}
      <Modal
        visible={showHistoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHistoryModal(false)}
      >
        <TouchableOpacity
          style={[styles.historyModalOverlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={() => setShowHistoryModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={[styles.historyModalContent, { paddingBottom: insets.bottom, backgroundColor: colors.modalBackground }]}
          >
            <View style={styles.historyModalHeader}>
              <Text style={[styles.historyModalTitle, { color: colors.text }]}>Group History</Text>
              <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {isLoadingHistory ? (
              <ActivityIndicator size="large" color={primaryColor} />
            ) : isHistoryError ? (
              <View style={styles.historyErrorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
                <Text style={[styles.historyErrorText, { color: colors.error }]}>
                  Failed to load history. Please try again.
                </Text>
              </View>
            ) : userHistory ? (
              <ScrollView style={styles.historyList}>
                <View style={[styles.historyUserInfo, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.historyUserName, { color: colors.text }]}>
                    {userHistory.first_name} {userHistory.last_name}
                  </Text>
                  <Text style={[styles.historyUserEmail, { color: colors.textSecondary }]}>{userHistory.email}</Text>
                </View>
                {userHistory.history.length === 0 ? (
                  <Text style={[styles.noHistoryText, { color: colors.textTertiary }]}>No group history</Text>
                ) : (
                  userHistory.history.map((entry: any, index: number) => (
                    <View key={`${entry.group_id}-${index}`} style={[styles.historyEntry, { borderBottomColor: colors.borderLight }]}>
                      <View style={styles.historyEntryHeader}>
                        <Text style={[styles.historyGroupName, { color: colors.text }]}>{entry.group_name}</Text>
                        <StatusBadge status={entry.request_status} isActive={entry.is_active} />
                      </View>
                      <Text style={[styles.historyGroupType, { color: colors.textSecondary }]}>{entry.group_type_name}</Text>
                      {entry.requested_at && (
                        <Text style={[styles.historyDate, { color: colors.textTertiary }]}>
                          Requested: {formatDate(entry.requested_at)}
                        </Text>
                      )}
                      {entry.joined_at && (
                        <Text style={[styles.historyDate, { color: colors.textTertiary }]}>
                          Joined: {formatDate(entry.joined_at)}
                        </Text>
                      )}
                      {entry.left_at && (
                        <Text style={[styles.historyDate, { color: colors.textTertiary }]}>
                          Left: {formatDate(entry.left_at)}
                        </Text>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
        </>
      )}
    </View>
  );
}

// Status badge component
function StatusBadge({ status, isActive }: { status: string | null; isActive: boolean }) {
  let color = "#999";
  let text = status || "unknown";

  if (isActive) {
    color = "#4CAF50";
    text = "Active";
  } else if (status === "pending") {
    color = "#FF9800";
  } else if (status === "declined") {
    color = "#FF6B6B";
  } else if (status === "accepted") {
    color = "#4CAF50";
  }

  return (
    <View style={[styles.statusBadge, { backgroundColor: color + "20" }]}>
      <Text style={[styles.statusBadgeText, { color }]}>{text}</Text>
    </View>
  );
}

// User request card component
interface UserRequestCardProps {
  user: UserPendingRequests;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAccept: (membershipId: Id<"groupMembers">, userName: string, groupName: string) => void;
  onDecline: (membershipId: Id<"groupMembers">, userId: string, groupName: string) => void;
  onViewHistory: () => void;
  formatDate: (date: number | string | null) => string;
  isProcessing: boolean;
  primaryColor: string;
}

function UserRequestCard({
  user,
  isExpanded,
  onToggleExpand,
  onAccept,
  onDecline,
  onViewHistory,
  formatDate,
  isProcessing,
  primaryColor,
}: UserRequestCardProps) {
  const { colors, isDark } = useTheme();
  const userName = `${user.first_name} ${user.last_name}`;
  const hasMultipleRequests = user.pending_requests.length > 1;
  const hasMemberships = user.current_memberships.length > 0;

  // Build membership summary
  const membershipSummary = Object.entries(user.membership_counts?.by_type || {})
    .map(([slug, count]) => `${count} ${slug.replace(/_/g, " ")}`)
    .join(", ");

  return (
    <View style={[styles.userCard, { backgroundColor: colors.surface }]}>
      {/* User Header */}
      <TouchableOpacity
        style={styles.userHeader}
        onPress={hasMultipleRequests ? onToggleExpand : undefined}
        activeOpacity={hasMultipleRequests ? 0.7 : 1}
      >
        <View style={styles.userAvatar}>
          {user.profile_photo ? (
            <Image source={{ uri: user.profile_photo }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
              <Text style={styles.avatarInitials}>
                {user.first_name?.[0]}
                {user.last_name?.[0]}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>{userName}</Text>
          <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{user.email}</Text>
          {hasMemberships && (
            <Text style={[styles.membershipSummary, { color: primaryColor }]}>
              Member of: {membershipSummary}
            </Text>
          )}
        </View>
        {hasMultipleRequests && (
          <View style={styles.expandIndicator}>
            <Text style={[styles.requestCount, { color: primaryColor, backgroundColor: `${primaryColor}20` }]}>{user.pending_requests.length}</Text>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textSecondary}
            />
          </View>
        )}
      </TouchableOpacity>

      {/* View History Button */}
      <TouchableOpacity style={[styles.historyButton, { borderTopColor: colors.borderLight, backgroundColor: colors.surfaceSecondary }]} onPress={onViewHistory}>
        <Ionicons name="time-outline" size={16} color={primaryColor} />
        <Text style={[styles.historyButtonText, { color: primaryColor }]}>View Full History</Text>
      </TouchableOpacity>

      {/* Request List */}
      {(hasMultipleRequests ? isExpanded : true) && (
        <View style={[styles.requestsList, { borderTopColor: colors.borderLight }]}>
          {user.pending_requests.map((request) => (
            <RequestItem
              key={request.membership_id}
              request={request}
              userName={userName}
              userId={user.user_id}
              onAccept={onAccept}
              onDecline={onDecline}
              formatDate={formatDate}
              isProcessing={isProcessing}
              primaryColor={primaryColor}
            />
          ))}
        </View>
      )}

      {/* Collapsed summary for multiple requests */}
      {hasMultipleRequests && !isExpanded && (
        <View style={styles.collapsedSummary}>
          <Text style={[styles.collapsedText, { color: colors.textSecondary }]}>
            Requesting: {user.pending_requests.map((r) => r.group_name).join(", ")}
          </Text>
        </View>
      )}
    </View>
  );
}

// Individual request item
interface RequestItemProps {
  request: PendingJoinRequest;
  userName: string;
  userId: Id<"users">;
  onAccept: (membershipId: Id<"groupMembers">, userName: string, groupName: string) => void;
  onDecline: (membershipId: Id<"groupMembers">, userId: string, groupName: string) => void;
  formatDate: (date: number | string | null) => string;
  isProcessing: boolean;
  primaryColor: string;
}

function RequestItem({
  request,
  userName,
  userId,
  onAccept,
  onDecline,
  formatDate,
  isProcessing,
  primaryColor,
}: RequestItemProps) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[styles.requestItem, { borderBottomColor: colors.borderLight }]}>
      <View style={styles.requestInfo}>
        <Text style={[styles.groupName, { color: colors.text }]}>{request.group_name}</Text>
        <Text style={[styles.groupType, { color: colors.textSecondary }]}>{request.group_type}</Text>
        <Text style={[styles.requestDate, { color: colors.textTertiary }]}>{formatDate(request.requested_at)}</Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: isDark ? 'rgba(255,107,107,0.2)' : '#FF6B6B20' }]}
          onPress={() => onDecline(request.membership_id, String(userId), request.group_name)}
          disabled={isProcessing}
        >
          <Ionicons name="close" size={18} color={colors.destructive} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: `${primaryColor}20` }]}
          onPress={() => onAccept(request.membership_id, userName, request.group_name)}
          disabled={isProcessing}
        >
          <Ionicons name="checkmark" size={18} color={primaryColor} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  subTabContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  subTab: {
    flex: 1,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  subTabActive: {
    borderBottomWidth: 2,
  },
  subTabText: {
    fontSize: 15,
    fontWeight: "500",
  },
  subTabTextActive: {
    fontWeight: "600",
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
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
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
  },
  userEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  membershipSummary: {
    fontSize: 12,
    marginTop: 4,
  },
  expandIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  requestCount: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  historyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  historyButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  requestsList: {
    borderTopWidth: 1,
  },
  collapsedSummary: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  collapsedText: {
    fontSize: 13,
    fontStyle: "italic",
  },
  requestItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingLeft: 76,
    borderBottomWidth: 1,
  },
  requestInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 15,
    fontWeight: "500",
  },
  groupType: {
    fontSize: 12,
    marginTop: 2,
  },
  requestDate: {
    fontSize: 11,
    marginTop: 2,
  },
  requestActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "500",
  },
  modalDeclineButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalDeclineText: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "600",
  },
  // History modal styles
  historyModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  historyModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: "50%",
    maxHeight: "80%",
    padding: 20,
  },
  historyModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  historyModalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  historyList: {
    flex: 1,
  },
  historyErrorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  historyErrorText: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
  },
  historyUserInfo: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  historyUserName: {
    fontSize: 16,
    fontWeight: "600",
  },
  historyUserEmail: {
    fontSize: 14,
    marginTop: 2,
  },
  noHistoryText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    padding: 20,
  },
  historyEntry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  historyEntryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyGroupName: {
    fontSize: 15,
    fontWeight: "500",
  },
  historyGroupType: {
    fontSize: 12,
    marginTop: 2,
  },
  historyDate: {
    fontSize: 11,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "500",
    textTransform: "capitalize",
  },
});
