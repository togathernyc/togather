import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@services/api/convex";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { AppImage } from "@components/ui";
import { ReachOutResolveModal } from "./ReachOutResolveModal";
import { useContactConfirmation } from "../hooks/useContactConfirmation";

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "Sent", color: "#FF9500", icon: "time-outline" },
  assigned: { label: "Seen", color: "#007AFF", icon: "eye-outline" },
  contacted: { label: "In Progress", color: "#5856D6", icon: "heart-outline" },
  resolved: { label: "Resolved", color: "#34C759", icon: "checkmark-circle-outline" },
  revoked: { label: "Withdrawn", color: "#999999", icon: "close-circle-outline" },
};

// Member-friendly status labels (shown below the badge)
const MEMBER_STATUS_DETAIL: Record<string, (name?: string) => string | null> = {
  pending: () => "Your leaders will see this soon",
  assigned: (name) => name ? `Your leader, ${name} has been made aware` : "A leader has been made aware",
  contacted: (name) => name ? `${name} has been looking into this` : "A leader has been looking into this",
  resolved: () => null,
  revoked: () => null,
};

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactAction = {
  id: string;
  type: string;
  performedById: Id<"users">;
  performedAt: number;
  notes?: string;
  performerName?: string;
};

type RequestData = {
  _id: Id<"reachOutRequests">;
  content: string;
  status: string;
  assignee?: {
    _id: Id<"users">;
    name: string;
    profilePhoto?: string | null;
  } | null;
  submitter?: {
    _id: Id<"users">;
    name: string;
    profilePhoto?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  // Leader-only fields
  contactActions?: ContactAction[];
  resolvedBy?: { _id: Id<"users">; name: string } | null;
  resolutionNotes?: string | null;
  resolvedAt?: number | null;
  // Member-only fields
  hasBeenContacted?: boolean;
  // Common
  createdAt: number;
  updatedAt: number;
};

interface ReachOutRequestCardProps {
  request: RequestData;
  variant: "member" | "leader";
  groupId?: Id<"groups">;
  leaders?: Array<{ _id: Id<"users">; name: string; profilePhoto?: string | null }>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReachOutRequestCard({
  request,
  variant,
  groupId,
  leaders,
}: ReachOutRequestCardProps) {
  const { primaryColor } = useCommunityTheme();
  const statusConfig = STATUS_CONFIG[request.status] ?? STATUS_CONFIG.pending;
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const isRevoked = request.status === "revoked";

  const assignRequest = useAuthenticatedMutation(api.functions.messaging.reachOut.assignRequest);
  const logContactAction = useAuthenticatedMutation(api.functions.messaging.reachOut.logContactAction);
  const unassignRequest = useAuthenticatedMutation(api.functions.messaging.reachOut.unassignRequest);
  const revokeRequest = useAuthenticatedMutation(api.functions.messaging.reachOut.revokeRequest);

  // Confirmation hook — logs action only after user confirms they completed it
  const { setPendingAction } = useContactConfirmation({
    onConfirm: async (type) => {
      try {
        await logContactAction({ requestId: request._id, type });
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to log contact action");
      }
    },
  });

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // ─── Leader action handlers ──────────────────────────────────────────────

  const handleAssign = useCallback(
    async (assignToUserId: Id<"users">) => {
      setActionLoading("assign");
      try {
        await assignRequest({ requestId: request._id, assignToUserId });
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to assign request");
      } finally {
        setActionLoading(null);
      }
    },
    [assignRequest, request._id]
  );

  const handleContact = useCallback(
    async (type: "call" | "text" | "email") => {
      const submitter = request.submitter;
      if (!submitter) return;

      let url: string | null = null;
      if (type === "call" && submitter.phone) url = `tel:${submitter.phone}`;
      else if (type === "text" && submitter.phone) url = `sms:${submitter.phone}`;
      else if (type === "email" && submitter.email) url = `mailto:${submitter.email}`;

      if (url) {
        try { await Linking.openURL(url); } catch { /* ignore */ }
      }

      // Set pending action — confirmation dialog appears when user returns to app
      setPendingAction(type, submitter.name);
    },
    [setPendingAction, request.submitter]
  );

  const handleUnassign = useCallback(async () => {
    setActionLoading("unassign");
    try {
      await unassignRequest({ requestId: request._id });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to unassign");
    } finally {
      setActionLoading(null);
    }
  }, [unassignRequest, request._id]);

  // ─── Member revoke handler ──────────────────────────────────────────────

  const handleRevoke = useCallback(() => {
    Alert.alert(
      "Withdraw Request",
      "Are you sure you want to withdraw this request? Your leaders will no longer act on it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setActionLoading("revoke");
            try {
              await revokeRequest({ requestId: request._id });
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to withdraw request");
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }, [revokeRequest, request._id]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  MEMBER VARIANT
  // ═══════════════════════════════════════════════════════════════════════════

  if (variant === "member") {
    const statusDetail = MEMBER_STATUS_DETAIL[request.status]?.(request.assignee?.name);

    // Revoked cards: collapsed, greyed out
    if (isRevoked) {
      return (
        <View style={[styles.card, styles.revokedCard]}>
          <View style={styles.cardHeader}>
            <View style={[styles.statusBadge, { backgroundColor: "#99915" }]}>
              <Ionicons name="close-circle-outline" size={14} color="#999" />
              <Text style={[styles.statusText, { color: "#999" }]}>Withdrawn</Text>
            </View>
            <Text style={styles.timeText}>{formatTime(request.createdAt)}</Text>
          </View>
          <Text style={styles.revokedContent} numberOfLines={1}>
            {request.content}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.card, { borderLeftColor: statusConfig.color }]}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + "15" }]}>
            <Ionicons name={statusConfig.icon as any} size={14} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
          <Text style={styles.timeText}>{formatTime(request.createdAt)}</Text>
        </View>

        {/* Content */}
        <Text style={styles.contentText}>{request.content}</Text>

        {/* Warm status detail */}
        {statusDetail && (
          <Text style={styles.memberStatusDetail}>{statusDetail}</Text>
        )}

        {/* Resolved indicator (simple, no notes) */}
        {request.status === "resolved" && (
          <View style={styles.resolvedBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            <Text style={styles.resolvedBannerText}>
              Your leader has followed up on this
            </Text>
          </View>
        )}

        {/* Withdraw button (only on non-resolved) */}
        {request.status !== "resolved" && (
          <TouchableOpacity
            style={styles.withdrawButton}
            onPress={handleRevoke}
            disabled={actionLoading === "revoke"}
          >
            {actionLoading === "revoke" ? (
              <ActivityIndicator size="small" color="#999" />
            ) : (
              <Text style={styles.withdrawText}>Withdraw</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LEADER VARIANT
  // ═══════════════════════════════════════════════════════════════════════════

  const contactActions = request.contactActions ?? [];

  return (
    <View style={[styles.card, { borderLeftColor: isRevoked ? "#999" : statusConfig.color }, isRevoked && styles.revokedCard]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + "15" }]}>
          <Ionicons name={statusConfig.icon as any} size={14} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
        <Text style={styles.timeText}>{formatTime(request.createdAt)}</Text>
      </View>

      {/* Submitter info */}
      {request.submitter && (
        <View style={styles.submitterRow}>
          {request.submitter.profilePhoto ? (
            <AppImage source={request.submitter.profilePhoto} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={14} color="#999" />
            </View>
          )}
          <Text style={styles.submitterName}>{request.submitter.name}</Text>
        </View>
      )}

      {/* Content */}
      <Text style={[styles.contentText, isRevoked && styles.revokedContent]}>
        {request.content}
      </Text>

      {/* Assignee info */}
      {request.assignee && !isRevoked && (
        <View style={styles.assigneeRow}>
          <Ionicons name="person-circle-outline" size={16} color="#666" />
          <Text style={styles.assigneeText}>Assigned to {request.assignee.name}</Text>
        </View>
      )}

      {/* Contact action history (leaders only) */}
      {contactActions.length > 0 && !isRevoked && (
        <View style={styles.actionsHistory}>
          {contactActions.map((action) => (
            <View key={action.id} style={styles.actionItem}>
              <Ionicons
                name={action.type === "call" ? "call-outline" : action.type === "text" ? "chatbubble-outline" : "mail-outline"}
                size={12}
                color="#666"
              />
              <Text style={styles.actionText}>
                {action.performerName ?? "Leader"}{" "}
                {action.type === "call" ? "called" : action.type === "text" ? "texted" : "emailed"}
                {" · "}{formatTime(action.performedAt)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Resolution notes (leaders only) */}
      {request.status === "resolved" && request.resolutionNotes && (
        <View style={styles.resolutionSection}>
          <Text style={styles.resolutionLabel}>Resolution</Text>
          <Text style={styles.resolutionText}>{request.resolutionNotes}</Text>
          {request.resolvedBy && (
            <Text style={styles.resolvedByText}>— {request.resolvedBy.name}</Text>
          )}
        </View>
      )}

      {/* Revoked indicator for leaders */}
      {isRevoked && (
        <Text style={styles.revokedNote}>Member withdrew this request</Text>
      )}

      {/* Leader action buttons */}
      {!isRevoked && request.status !== "resolved" && (
        <View style={styles.actionsSection}>
          {/* Assignment */}
          {request.status === "pending" && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: primaryColor + "15" }]}
                onPress={() => {
                  if (leaders && leaders.length > 0) {
                    Alert.alert("Assign to", "Select a leader", [
                      ...leaders.map((leader) => ({
                        text: leader.name,
                        onPress: () => handleAssign(leader._id),
                      })),
                      { text: "Cancel", style: "cancel" as const },
                    ]);
                  }
                }}
                disabled={actionLoading === "assign"}
              >
                {actionLoading === "assign" ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <>
                    <Ionicons name="person-add-outline" size={16} color={primaryColor} />
                    <Text style={[styles.actionButtonText, { color: primaryColor }]}>Assign</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Contact buttons */}
          {(request.status === "assigned" || request.status === "contacted") && (
            <View style={styles.actionRow}>
              {request.submitter?.phone && (
                <>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: "#34C75915" }]}
                    onPress={() => handleContact("call")}
                    disabled={actionLoading === "call"}
                  >
                    {actionLoading === "call" ? (
                      <ActivityIndicator size="small" color="#34C759" />
                    ) : (
                      <>
                        <Ionicons name="call-outline" size={16} color="#34C759" />
                        <Text style={[styles.actionButtonText, { color: "#34C759" }]}>Call</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: "#5856D615" }]}
                    onPress={() => handleContact("text")}
                    disabled={actionLoading === "text"}
                  >
                    {actionLoading === "text" ? (
                      <ActivityIndicator size="small" color="#5856D6" />
                    ) : (
                      <>
                        <Ionicons name="chatbubble-outline" size={16} color="#5856D6" />
                        <Text style={[styles.actionButtonText, { color: "#5856D6" }]}>Text</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
              {request.submitter?.email && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: "#007AFF15" }]}
                  onPress={() => handleContact("email")}
                  disabled={actionLoading === "email"}
                >
                  {actionLoading === "email" ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                  ) : (
                    <>
                      <Ionicons name="mail-outline" size={16} color="#007AFF" />
                      <Text style={[styles.actionButtonText, { color: "#007AFF" }]}>Email</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Resolve + Unassign */}
          {(request.status === "assigned" || request.status === "contacted") && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#34C75915" }]}
                onPress={() => setShowResolveModal(true)}
              >
                <Ionicons name="checkmark-circle-outline" size={16} color="#34C759" />
                <Text style={[styles.actionButtonText, { color: "#34C759" }]}>Resolve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: "#FF3B3015" }]}
                onPress={handleUnassign}
                disabled={actionLoading === "unassign"}
              >
                {actionLoading === "unassign" ? (
                  <ActivityIndicator size="small" color="#FF3B30" />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={16} color="#FF3B30" />
                    <Text style={[styles.actionButtonText, { color: "#FF3B30" }]}>Unassign</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Resolve modal */}
      <ReachOutResolveModal
        visible={showResolveModal}
        requestId={request._id}
        onClose={() => setShowResolveModal(false)}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  revokedCard: {
    borderLeftColor: "#ddd",
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  timeText: {
    fontSize: 12,
    color: "#999",
  },
  contentText: {
    fontSize: 15,
    color: "#333",
    lineHeight: 21,
    marginBottom: 8,
  },
  revokedContent: {
    color: "#999",
    fontSize: 14,
  },

  // ─── Member variant ────────────────────────────────────────────────────
  memberStatusDetail: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
    marginBottom: 8,
  },
  resolvedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#34C75910",
    borderRadius: 8,
    marginBottom: 4,
  },
  resolvedBannerText: {
    fontSize: 14,
    color: "#34C759",
    fontWeight: "500",
  },
  withdrawButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginTop: 4,
  },
  withdrawText: {
    fontSize: 13,
    color: "#999",
  },
  revokedNote: {
    fontSize: 13,
    color: "#999",
    fontStyle: "italic",
    marginTop: 4,
  },

  // ─── Leader variant ────────────────────────────────────────────────────
  submitterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  submitterName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  assigneeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  assigneeText: {
    fontSize: 13,
    color: "#666",
  },
  actionsHistory: {
    marginTop: 4,
    gap: 2,
  },
  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actionText: {
    fontSize: 12,
    color: "#666",
  },
  resolutionSection: {
    marginTop: 8,
    padding: 10,
    backgroundColor: "#34C75910",
    borderRadius: 8,
  },
  resolutionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#34C759",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  resolutionText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  resolvedByText: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
    fontStyle: "italic",
  },
  actionsSection: {
    marginTop: 10,
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
