/**
 * GroupCreationRequestsContent - Admin content for group creation requests.
 *
 * Displays pending group creation requests for admin review.
 * Admins can approve (with modifications) or decline requests.
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
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow, format } from "date-fns";
import { useQuery, useMutation } from "@services/api/convex";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { formatError } from "@/utils/error-handling";

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function GroupCreationRequestsContent() {
  const insets = useSafeAreaInsets();
  const { community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLeader, setSelectedLeader] = useState<any>(null);
  const [showLeaderModal, setShowLeaderModal] = useState(false);

  const communityId = community?.id as Id<"communities"> | undefined;

  // Fetch pending group creation requests using Convex
  const requests = useQuery(
    api.functions.admin.requests.listGroupCreationRequests,
    communityId && token ? { token, communityId } : "skip"
  );

  const isLoading = requests === undefined;
  const isError = requests === null;

  // Review mutation using Convex
  const reviewGroupCreationRequest = useMutation(api.functions.admin.requests.reviewGroupCreationRequest);

  const handleReview = useCallback(async (requestId: Id<"groupCreationRequests">, action: "approve" | "decline", declineReasonText?: string) => {
    if (!communityId || !token) return;

    try {
      const result = await reviewGroupCreationRequest({
        token,
        communityId,
        requestId,
        action,
        declineReason: declineReasonText,
      });

      if (result.action === "approved") {
        Alert.alert(
          "Group Created",
          `"${result.group?.name}" has been created and the leaders have been notified.`
        );
      } else {
        Alert.alert("Request Declined", "The requester will not be notified.");
      }
      setShowApproveModal(false);
      setShowDeclineModal(false);
      setSelectedRequest(null);
      setDeclineReason("");
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to process request"));
    }
  }, [communityId, token, reviewGroupCreationRequest]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Convex queries auto-refresh, just wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  }, []);

  const handleApprove = (request: any) => {
    setSelectedRequest(request);
    setShowApproveModal(true);
  };

  const handleDecline = (request: any) => {
    setSelectedRequest(request);
    setShowDeclineModal(true);
  };

  const [isReviewing, setIsReviewing] = useState(false);

  const confirmApprove = async () => {
    if (!selectedRequest) return;
    setIsReviewing(true);
    await handleReview(selectedRequest.id, "approve");
    setIsReviewing(false);
  };

  const confirmDecline = async () => {
    if (!selectedRequest) return;
    setIsReviewing(true);
    await handleReview(selectedRequest.id, "decline", declineReason.trim() || undefined);
    setIsReviewing(false);
  };

  const toggleExpand = (requestId: string) => {
    setExpandedRequestId(expandedRequestId === requestId ? null : requestId);
  };

  const getInitials = (firstName: string | null | undefined, lastName: string | null | undefined) => {
    const first = firstName?.[0] || "";
    const last = lastName?.[0] || "";
    return `${first}${last}`.toUpperCase() || "?";
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={styles.loadingText}>Loading requests...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorTitle}>Failed to load requests</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!requests || requests.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="checkmark-circle-outline"
          size={64}
          color={primaryColor}
        />
        <Text style={styles.emptyTitle}>All caught up!</Text>
        <Text style={styles.emptySubtext}>
          No pending group creation requests
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          colors={[primaryColor]}
          tintColor={primaryColor}
        />
      }
    >
      {requests.map((request) => (
        <TouchableOpacity
          key={request.id}
          style={styles.requestCard}
          onPress={() => toggleExpand(request.id)}
          activeOpacity={0.7}
        >
          {/* Header Row */}
          <View style={styles.cardHeader}>
            <View style={[styles.avatar, { backgroundColor: primaryColor }]}>
              {request.requester.profilePhoto ? (
                <Image
                  source={{ uri: request.requester.profilePhoto }}
                  style={styles.avatarImage}
                />
              ) : (
                <Text style={styles.avatarText}>
                  {getInitials(
                    request.requester.firstName,
                    request.requester.lastName
                  )}
                </Text>
              )}
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.requesterName}>
                {request.requester.firstName} {request.requester.lastName}
              </Text>
              <Text style={styles.groupName}>{request.name}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.groupType}>{request.groupType.name}</Text>
                <Text style={styles.timeAgo}>
                  {formatDistanceToNow(new Date(request.createdAt), {
                    addSuffix: true,
                  })}
                </Text>
              </View>
            </View>
            <Ionicons
              name={expandedRequestId === request.id ? "chevron-up" : "chevron-down"}
              size={24}
              color="#999"
            />
          </View>

          {/* Expanded Content */}
          {expandedRequestId === request.id && (
            <View style={styles.expandedContent}>
              {/* Requester Stats */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{request.requester.groupCount}</Text>
                  <Text style={styles.statLabel}>Groups</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{request.requester.leaderCount}</Text>
                  <Text style={styles.statLabel}>Leading</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {request.requester.memberSince
                      ? format(new Date(request.requester.memberSince), "MMM yyyy")
                      : "N/A"}
                  </Text>
                  <Text style={styles.statLabel}>Member Since</Text>
                </View>
              </View>

              {/* Group Details */}
              {request.description && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Description</Text>
                  <Text style={styles.detailValue}>{request.description}</Text>
                </View>
              )}

              {request.proposedStartDay != null && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Meeting Day</Text>
                  <Text style={styles.detailValue}>
                    {DAYS_OF_WEEK[request.proposedStartDay]}
                  </Text>
                </View>
              )}

              {request.location && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Location</Text>
                  <Text style={styles.detailValue}>{request.location}</Text>
                </View>
              )}

              {request.proposedLeaders && request.proposedLeaders.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Proposed Co-Leaders</Text>
                  <View style={styles.leadersGrid}>
                    {request.proposedLeaders.map((leader: any) => (
                      <TouchableOpacity
                        key={leader.id}
                        style={styles.leaderCard}
                        onPress={() => {
                          setSelectedLeader(leader);
                          setShowLeaderModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.leaderAvatar, { backgroundColor: primaryColor }]}>
                          {leader.profilePhoto ? (
                            <Image
                              source={{ uri: leader.profilePhoto }}
                              style={styles.leaderAvatarImage}
                            />
                          ) : (
                            <Text style={styles.leaderAvatarText}>
                              {getInitials(leader.firstName, leader.lastName)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.leaderInfo}>
                          <Text style={styles.leaderName} numberOfLines={1}>
                            {leader.firstName} {leader.lastName}
                          </Text>
                          <Text style={styles.leaderGroups} numberOfLines={1}>
                            {leader.groups && leader.groups.length > 0
                              ? `${leader.groups.length} group${leader.groups.length > 1 ? 's' : ''}`
                              : 'No groups yet'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#999" />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Contact Info */}
              <View style={styles.contactSection}>
                {request.requester.email && (
                  <View style={styles.contactRow}>
                    <Ionicons name="mail-outline" size={16} color="#666" />
                    <Text style={styles.contactText}>{request.requester.email}</Text>
                  </View>
                )}
                {request.requester.phone && (
                  <View style={styles.contactRow}>
                    <Ionicons name="call-outline" size={16} color="#666" />
                    <Text style={styles.contactText}>{request.requester.phone}</Text>
                  </View>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => handleDecline(request)}
                  disabled={isReviewing}
                >
                  <Ionicons name="close" size={20} color="#FF3B30" />
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.approveButton, { backgroundColor: primaryColor }]}
                  onPress={() => handleApprove(request)}
                  disabled={isReviewing}
                >
                  {isReviewing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={20} color="#fff" />
                      <Text style={styles.approveButtonText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ))}

      {/* Approve Confirmation Modal */}
      <Modal
        visible={showApproveModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowApproveModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Approve Request?</Text>
            <Text style={styles.modalText}>
              This will create the group "{selectedRequest?.name}" and add{" "}
              {selectedRequest?.requester?.firstName} as a leader.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowApproveModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: primaryColor }]}
                onPress={confirmApprove}
                disabled={isReviewing}
              >
                {isReviewing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Approve</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Decline Modal */}
      <Modal
        visible={showDeclineModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeclineModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Decline Request?</Text>
            <Text style={styles.modalText}>
              Add an optional reason (not sent to requester):
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Reason for declining (optional)"
              value={declineReason}
              onChangeText={setDeclineReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowDeclineModal(false);
                  setDeclineReason("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmButton, { backgroundColor: "#FF3B30" }]}
                onPress={confirmDecline}
                disabled={isReviewing}
              >
                {isReviewing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Decline</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Leader Detail Modal */}
      <Modal
        visible={showLeaderModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLeaderModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.leaderModalContent}>
            <View style={styles.leaderModalHeader}>
              <Text style={styles.modalTitle}>Co-Leader Details</Text>
              <TouchableOpacity
                onPress={() => setShowLeaderModal(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {selectedLeader && (
              <View style={styles.leaderDetailContainer}>
                {/* Avatar and Name */}
                <View style={styles.leaderDetailHeader}>
                  <View style={[styles.leaderDetailAvatar, { backgroundColor: primaryColor }]}>
                    {selectedLeader.profilePhoto ? (
                      <Image
                        source={{ uri: selectedLeader.profilePhoto }}
                        style={styles.leaderDetailAvatarImage}
                      />
                    ) : (
                      <Text style={styles.leaderDetailAvatarText}>
                        {getInitials(selectedLeader.firstName, selectedLeader.lastName)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.leaderDetailName}>
                    {selectedLeader.firstName} {selectedLeader.lastName}
                  </Text>
                </View>

                {/* Contact Info */}
                {selectedLeader.email && (
                  <View style={styles.leaderDetailRow}>
                    <Ionicons name="mail-outline" size={20} color="#666" />
                    <Text style={styles.leaderDetailText}>{selectedLeader.email}</Text>
                  </View>
                )}
                {selectedLeader.phone && (
                  <View style={styles.leaderDetailRow}>
                    <Ionicons name="call-outline" size={20} color="#666" />
                    <Text style={styles.leaderDetailText}>{selectedLeader.phone}</Text>
                  </View>
                )}

                {/* Groups */}
                <View style={styles.leaderGroupsSection}>
                  <Text style={styles.leaderGroupsTitle}>Current Groups</Text>
                  {selectedLeader.groups && selectedLeader.groups.length > 0 ? (
                    selectedLeader.groups.map((groupName: string, index: number) => (
                      <View key={index} style={styles.leaderGroupItem}>
                        <Ionicons name="people-outline" size={16} color={primaryColor} />
                        <Text style={styles.leaderGroupText}>{groupName}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noGroupsText}>Not currently in any groups</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#007AFF",
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
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
  emptySubtext: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  requestCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  headerInfo: {
    flex: 1,
  },
  requesterName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  groupName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#007AFF",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 8,
  },
  groupType: {
    fontSize: 13,
    color: "#666",
  },
  timeAgo: {
    fontSize: 12,
    color: "#999",
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginTop: 12,
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  detailSection: {
    marginTop: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 15,
    color: "#333",
    marginTop: 4,
    lineHeight: 22,
  },
  contactSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  contactText: {
    fontSize: 14,
    color: "#666",
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  declineButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF3B30",
  },
  declineButtonText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
  approveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  approveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  modalText: {
    fontSize: 16,
    color: "#666",
    lineHeight: 22,
    marginBottom: 16,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  // Leader Cards
  leadersGrid: {
    marginTop: 8,
    gap: 8,
  },
  leaderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9F9F9",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  leaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  leaderAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  leaderAvatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  leaderInfo: {
    flex: 1,
  },
  leaderName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  leaderGroups: {
    fontSize: 13,
    color: "#666",
  },
  // Leader Detail Modal
  leaderModalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 0,
    width: "100%",
    maxWidth: 500,
    maxHeight: "80%",
  },
  leaderModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  closeButton: {
    padding: 4,
  },
  leaderDetailContainer: {
    padding: 20,
  },
  leaderDetailHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  leaderDetailAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  leaderDetailAvatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  leaderDetailAvatarText: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "600",
  },
  leaderDetailName: {
    fontSize: 22,
    fontWeight: "600",
    color: "#333",
  },
  leaderDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  leaderDetailText: {
    fontSize: 16,
    color: "#333",
  },
  leaderGroupsSection: {
    marginTop: 24,
  },
  leaderGroupsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  leaderGroupItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#F9F9F9",
    borderRadius: 8,
    marginBottom: 8,
  },
  leaderGroupText: {
    fontSize: 15,
    color: "#333",
  },
  noGroupsText: {
    fontSize: 15,
    color: "#999",
    fontStyle: "italic",
  },
});
