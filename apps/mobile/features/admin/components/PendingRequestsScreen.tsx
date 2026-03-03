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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { useQuery, useAuthenticatedMutation } from "@services/api/convex";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "../../../utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatError } from "@/utils/error-handling";

// Types for the component
interface PendingJoinRequest {
  id: Id<"groupMembers">;
  groupId: Id<"groups">;
  groupName: string;
  groupTypeId: Id<"groupTypes"> | null;
  groupTypeName: string;
  groupTypeSlug: string;
  requestedAt: number | null;
}

interface CurrentMembership {
  groupId: Id<"groups">;
  groupName: string;
  groupTypeSlug: string;
  role: string;
  joinedAt: number;
}

interface UserPendingRequests {
  user: {
    id: Id<"users">;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    profilePhoto: string | null;
  };
  pendingRequestsCount: number;
  pendingRequests: PendingJoinRequest[];
  currentMemberships: CurrentMembership[];
  membershipCountsByType: Record<string, number>;
}

/**
 * Screen for community admins to manage pending group join requests.
 * Shows a user-centric view: each user with all their pending requests.
 */
export function PendingRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
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

  const isLoading = rawPendingRequests === undefined;
  const isError = rawPendingRequests === null;

  // Transform to match the expected interface
  const pendingRequests: UserPendingRequests[] | undefined = rawPendingRequests?.map((item: any) => ({
    user: {
      id: item.user.id,
      firstName: item.user.firstName,
      lastName: item.user.lastName,
      email: item.user.email,
      phone: item.user.phone,
      profilePhoto: item.user.profilePhoto,
    },
    pendingRequestsCount: item.pendingRequestsCount,
    pendingRequests: item.pendingRequests.map((req: any) => ({
      id: req.id,
      groupId: req.groupId,
      groupName: req.groupName,
      groupTypeId: req.groupTypeId,
      groupTypeName: req.groupTypeName,
      groupTypeSlug: req.groupTypeSlug,
      requestedAt: req.requestedAt,
    })),
    currentMemberships: item.currentMemberships.map((m: any) => ({
      groupId: m.groupId,
      groupName: m.groupName,
      groupTypeSlug: m.groupTypeSlug,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    membershipCountsByType: item.membershipCountsByType,
  }));

  // Fetch user history when modal is open using Convex
  const rawUserHistory = useQuery(
    api.functions.admin.members.getUserGroupHistory,
    communityId && selectedUserId && showHistoryModal && token
      ? { token, communityId, targetUserId: selectedUserId as Id<"users"> }
      : "skip"
  );

  const isLoadingHistory = rawUserHistory === undefined && showHistoryModal && selectedUserId !== null;
  const isHistoryError = rawUserHistory === null;

  // Find user info for selected user
  const selectedUserInfo = selectedUserId
    ? pendingRequests?.find((u) => u.user.id === selectedUserId)
    : null;

  const userHistory = rawUserHistory && selectedUserInfo ? {
    first_name: selectedUserInfo.user.firstName,
    last_name: selectedUserInfo.user.lastName,
    email: selectedUserInfo.user.email || "",
    history: rawUserHistory.map((entry: any) => ({
      group_id: entry.groupId,
      group_name: entry.groupName,
      group_type_name: entry.groupTypeName,
      group_type_slug: entry.groupTypeSlug,
      role: entry.role,
      is_active: entry.leftAt === null && entry.requestStatus === "accepted",
      request_status: entry.requestStatus,
      requested_at: entry.requestedAt,
      joined_at: entry.joinedAt,
      left_at: entry.leftAt,
      request_reviewed_at: entry.requestReviewedAt,
    })),
  } : null;

  // Review mutation using Convex
  const reviewPendingRequest = useAuthenticatedMutation(api.functions.admin.requests.reviewPendingRequest);

  const handleReview = useCallback(async (membershipId: Id<"groupMembers">, action: "accept" | "decline", declineReasonText?: string) => {
    if (!communityId) return;

    setIsReviewing(true);
    try {
      await reviewPendingRequest({
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
  }, [communityId, reviewPendingRequest]);

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
        <Text style={styles.loadingText}>Loading requests...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF6B6B" />
        <Text style={styles.errorText}>Failed to load requests</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEmpty = !pendingRequests || pendingRequests.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Pending Requests</Text>
            <Text style={styles.headerSubtitle}>
              {isEmpty
                ? "No pending requests"
                : `${pendingRequests.reduce((acc, u) => acc + u.pendingRequests.length, 0)} requests from ${pendingRequests.length} people`}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.integrationsButton, { backgroundColor: `${primaryColor}10`, borderColor: `${primaryColor}30` }]}
            onPress={() => router.push("/leader-tools/integrations")}
          >
            <Ionicons name="link-outline" size={20} color={primaryColor} />
            <Text style={[styles.integrationsButtonText, { color: primaryColor }]}>Integrations</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle-outline" size={64} color={primaryColor} />
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptySubtitle}>
            There are no pending group join requests at this time.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {pendingRequests.map((userEntry) => (
            <UserRequestCard
              key={String(userEntry.user.id)}
              user={userEntry}
              isExpanded={expandedUserId === userEntry.user.id}
              onToggleExpand={() => toggleExpanded(userEntry.user.id)}
              onAccept={handleAccept}
              onDecline={handleDeclinePress}
              onViewHistory={() => handleViewHistory(userEntry.user.id)}
              formatDate={formatDate}
              isProcessing={isReviewing}
            />
          ))}
        </ScrollView>
      )}

      {/* Decline Reason Modal */}
      <Modal
        visible={showDeclineModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeclineModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Decline Request</Text>
            <Text style={styles.modalSubtitle}>
              Optionally provide a reason for declining.
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Reason (optional)"
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
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalDeclineButton}
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
          style={styles.historyModalOverlay}
          activeOpacity={1}
          onPress={() => setShowHistoryModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={[styles.historyModalContent, { paddingBottom: insets.bottom }]}
          >
            <View style={styles.historyModalHeader}>
              <Text style={styles.historyModalTitle}>Group History</Text>
              <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {isLoadingHistory ? (
              <ActivityIndicator size="large" color={primaryColor} />
            ) : isHistoryError ? (
              <View style={styles.historyErrorContainer}>
                <Ionicons name="alert-circle-outline" size={48} color="#FF6B6B" />
                <Text style={styles.historyErrorText}>
                  Failed to load history. Please try again.
                </Text>
              </View>
            ) : userHistory ? (
              <ScrollView style={styles.historyList}>
                <View style={styles.historyUserInfo}>
                  <Text style={styles.historyUserName}>
                    {userHistory.first_name} {userHistory.last_name}
                  </Text>
                  <Text style={styles.historyUserEmail}>{userHistory.email}</Text>
                </View>
                {userHistory.history.length === 0 ? (
                  <Text style={styles.noHistoryText}>No group history</Text>
                ) : (
                  userHistory.history.map((entry: any, index: number) => (
                    <View key={`${entry.group_id}-${index}`} style={styles.historyEntry}>
                      <View style={styles.historyEntryHeader}>
                        <Text style={styles.historyGroupName}>{entry.group_name}</Text>
                        <StatusBadge status={entry.request_status} isActive={entry.is_active} />
                      </View>
                      <Text style={styles.historyGroupType}>{entry.group_type_name}</Text>
                      {entry.requested_at && (
                        <Text style={styles.historyDate}>
                          Requested: {formatDate(entry.requested_at)}
                        </Text>
                      )}
                      {entry.joined_at && (
                        <Text style={styles.historyDate}>
                          Joined: {formatDate(entry.joined_at)}
                        </Text>
                      )}
                      {entry.left_at && (
                        <Text style={styles.historyDate}>
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
}: UserRequestCardProps) {
  const { primaryColor } = useCommunityTheme();
  const userName = `${user.user.firstName} ${user.user.lastName}`;
  const hasMultipleRequests = user.pendingRequests.length > 1;
  const hasMemberships = user.currentMemberships.length > 0;

  // Build membership summary
  const membershipSummary = Object.entries(user.membershipCountsByType)
    .map(([slug, count]) => `${count} ${slug.replace(/_/g, " ")}`)
    .join(", ");

  return (
    <View style={styles.userCard}>
      {/* User Header */}
      <TouchableOpacity
        style={styles.userHeader}
        onPress={hasMultipleRequests ? onToggleExpand : undefined}
        activeOpacity={hasMultipleRequests ? 0.7 : 1}
      >
        <View style={styles.userAvatar}>
          {user.user.profilePhoto ? (
            <Image source={{ uri: user.user.profilePhoto }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
              <Text style={styles.avatarInitials}>
                {user.user.firstName?.[0]}
                {user.user.lastName?.[0]}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{userName}</Text>
          <Text style={styles.userEmail}>{user.user.email}</Text>
          {hasMemberships && (
            <Text style={[styles.membershipSummary, { color: primaryColor }]}>
              Member of: {membershipSummary}
            </Text>
          )}
        </View>
        {hasMultipleRequests && (
          <View style={styles.expandIndicator}>
            <Text style={[styles.requestCount, { color: primaryColor, backgroundColor: `${primaryColor}20` }]}>{user.pendingRequests.length}</Text>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color="#666"
            />
          </View>
        )}
      </TouchableOpacity>

      {/* View History Button */}
      <TouchableOpacity style={styles.historyButton} onPress={onViewHistory}>
        <Ionicons name="time-outline" size={16} color={primaryColor} />
        <Text style={[styles.historyButtonText, { color: primaryColor }]}>View Full History</Text>
      </TouchableOpacity>

      {/* Request List */}
      {(hasMultipleRequests ? isExpanded : true) && (
        <View style={styles.requestsList}>
          {user.pendingRequests.map((request) => (
            <RequestItem
              key={String(request.id)}
              request={request}
              userName={userName}
              userId={user.user.id}
              onAccept={onAccept}
              onDecline={onDecline}
              formatDate={formatDate}
              isProcessing={isProcessing}
            />
          ))}
        </View>
      )}

      {/* Collapsed summary for multiple requests */}
      {hasMultipleRequests && !isExpanded && (
        <View style={styles.collapsedSummary}>
          <Text style={styles.collapsedText}>
            Requesting: {user.pendingRequests.map((r) => r.groupName).join(", ")}
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
}

function RequestItem({
  request,
  userName,
  userId,
  onAccept,
  onDecline,
  formatDate,
  isProcessing,
}: RequestItemProps) {
  const { primaryColor } = useCommunityTheme();

  return (
    <View style={styles.requestItem}>
      <View style={styles.requestInfo}>
        <Text style={styles.groupName}>{request.groupName}</Text>
        <Text style={styles.groupType}>{request.groupTypeName}</Text>
        <Text style={styles.requestDate}>{formatDate(request.requestedAt)}</Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.declineButton]}
          onPress={() => onDecline(request.id, String(userId), request.groupName)}
          disabled={isProcessing}
        >
          <Ionicons name="close" size={18} color="#FF6B6B" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: `${primaryColor}20` }]}
          onPress={() => onAccept(request.id, userName, request.groupName)}
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
    backgroundColor: "#f5f5f5",
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
    color: "#666",
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: "#FF6B6B",
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  header: {
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  integrationsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  integrationsButtonText: {
    fontSize: 14,
    fontWeight: "500",
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
    color: "#333",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
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
  userCard: {
    backgroundColor: "#fff",
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
    color: "#333",
  },
  userEmail: {
    fontSize: 13,
    color: "#666",
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
    borderTopColor: "#f0f0f0",
    backgroundColor: "#fafafa",
  },
  historyButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  requestsList: {
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  collapsedSummary: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  collapsedText: {
    fontSize: 13,
    color: "#666",
    fontStyle: "italic",
  },
  requestItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingLeft: 76,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  requestInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  groupType: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  requestDate: {
    fontSize: 11,
    color: "#999",
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
  declineButton: {
    backgroundColor: "#FF6B6B20",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: "#ddd",
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
    color: "#666",
    fontWeight: "500",
  },
  modalDeclineButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FF6B6B",
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
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  historyModalContent: {
    backgroundColor: "#fff",
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
    color: "#333",
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
    color: "#FF6B6B",
    textAlign: "center",
    marginTop: 12,
  },
  historyUserInfo: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  historyUserName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  historyUserEmail: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  noHistoryText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 20,
  },
  historyEntry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  historyEntryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyGroupName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  historyGroupType: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  historyDate: {
    fontSize: 11,
    color: "#999",
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
