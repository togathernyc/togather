/**
 * BroadcastDetailModal — Full broadcast preview with status-based actions.
 *
 * Actions by status & role:
 *   draft            → creator:  Send Test, Submit for Approval
 *   pending_approval → creator:  Send Test (waiting message)
 *                    → other:    Send Test, Approve, Reject
 *   approved         → any:     Send Now
 *   sent / rejected  → (read-only)
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface Broadcast {
  _id: string;
  title: string;
  body: string;
  channels: string[];
  targetUserCount: number;
  targetCriteria: { type: string; groupTypeSlug?: string; daysThreshold?: number };
  status: string;
  createdById: string;
  createdByName: string;
  createdAt: number;
  deepLink?: string;
}

interface BroadcastDetailModalProps {
  visible: boolean;
  broadcast: Broadcast | null;
  onClose: () => void;
}

function formatCriteria(criteria: { type: string; groupTypeSlug?: string; daysThreshold?: number }): string {
  switch (criteria.type) {
    case "all_users": return "All users";
    case "new_users": return `New users (${criteria.daysThreshold || 30} days)`;
    case "no_profile_pic": return "No profile picture";
    case "no_group_of_type": return `No ${criteria.groupTypeSlug || "group"}`;
    case "leaders_no_group_image": return "Leaders without group image";
    default: return criteria.type;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "draft": return "#94a3b8";
    case "pending_approval": return "#f59e0b";
    case "approved": return "#22c55e";
    case "sent": return "#3b82f6";
    case "rejected": return "#ef4444";
    default: return "#94a3b8";
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case "draft": return "Draft";
    case "pending_approval": return "Pending Approval";
    case "approved": return "Approved";
    case "sent": return "Sent";
    case "rejected": return "Rejected";
    default: return status;
  }
}

function formatDeepLink(deepLink: string): string {
  switch (deepLink) {
    case "per_user_group": return "Open their group";
    case "/(user)/edit-profile": return "Edit profile";
    case "/(tabs)/search": return "Browse groups";
    default: return deepLink;
  }
}

export function BroadcastDetailModal({ visible, broadcast, onClose }: BroadcastDetailModalProps) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [loading, setLoading] = useState<string | null>(null);

  const sendTestMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.sendTestToSelf);
  const requestApprovalMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.requestApproval);
  const approveMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.approve);
  const rejectMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.reject);
  const sendMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.sendBroadcast);
  const deleteMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.deleteBroadcast);

  if (!broadcast) return null;

  const isCreator = broadcast.createdById === user?.id;
  const broadcastId = broadcast._id as Id<"adminBroadcasts">;

  const handleAction = async (
    action: string,
    fn: (args: { broadcastId: Id<"adminBroadcasts"> }) => Promise<any>,
    successMsg: string,
  ) => {
    setLoading(action);
    try {
      await fn({ broadcastId });
      Alert.alert("Success", successMsg);
      if (action !== "test") onClose();
    } catch (error: any) {
      Alert.alert("Error", error.message || `Failed to ${action}.`);
    } finally {
      setLoading(null);
    }
  };

  const confirmAndRun = (
    title: string,
    message: string,
    action: string,
    fn: (args: { broadcastId: Id<"adminBroadcasts"> }) => Promise<any>,
    successMsg: string,
    destructive?: boolean,
  ) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        style: destructive ? "destructive" : "default",
        onPress: () => handleAction(action, fn, successMsg),
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: colors.surface }]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(broadcast.status) }]}>
              <Text style={styles.statusBadgeText}>{formatStatus(broadcast.status)}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Title */}
            <Text style={[styles.title, { color: colors.text }]}>{broadcast.title}</Text>

            {/* Body */}
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{broadcast.body}</Text>

            {/* Meta */}
            <View style={[styles.metaSection, { borderTopColor: colors.border }]}>
              <MetaRow icon="people-outline" label="Target" value={formatCriteria(broadcast.targetCriteria)} colors={colors} />
              <MetaRow icon="person-outline" label="Recipients" value={`${broadcast.targetUserCount} users`} colors={colors} />
              <MetaRow icon="megaphone-outline" label="Channels" value={broadcast.channels.join(", ")} colors={colors} />
              <MetaRow icon="person-circle-outline" label="Created by" value={broadcast.createdByName} colors={colors} />
              {broadcast.deepLink && (
                <MetaRow icon="link-outline" label="Tap action" value={formatDeepLink(broadcast.deepLink)} colors={colors} />
              )}
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              {/* Send Test — available in draft & pending_approval */}
              {(broadcast.status === "draft" || broadcast.status === "pending_approval") && (
                <TouchableOpacity
                  style={[styles.outlineButton, { borderColor: colors.border }]}
                  onPress={() => handleAction("test", sendTestMutation, "Test notification sent to you.")}
                  disabled={loading !== null}
                >
                  {loading === "test" ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <>
                      <Ionicons name="paper-plane-outline" size={18} color={colors.text} />
                      <Text style={[styles.outlineButtonText, { color: colors.text }]}>Send Test to Myself</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Draft: Submit for Approval */}
              {broadcast.status === "draft" && isCreator && (
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: DEFAULT_PRIMARY_COLOR }]}
                  onPress={() => confirmAndRun(
                    "Submit for Approval",
                    "Another admin must approve before this can be sent.",
                    "submit",
                    requestApprovalMutation,
                    "Submitted for approval.",
                  )}
                  disabled={loading !== null}
                >
                  {loading === "submit" ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                      <Text style={styles.primaryButtonText}>Submit for Approval</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Pending: Creator sees waiting message */}
              {broadcast.status === "pending_approval" && isCreator && (
                <Text style={[styles.waitingText, { color: colors.textSecondary }]}>
                  Waiting for another admin to approve
                </Text>
              )}

              {/* Pending: Other admin can approve/reject */}
              {broadcast.status === "pending_approval" && !isCreator && (
                <View style={styles.approvalRow}>
                  <TouchableOpacity
                    style={[styles.rejectButton, { borderColor: "#ef4444" }]}
                    onPress={() => confirmAndRun(
                      "Reject",
                      `Reject "${broadcast.title}"?`,
                      "reject",
                      rejectMutation,
                      "Broadcast rejected.",
                      true,
                    )}
                    disabled={loading !== null}
                  >
                    {loading === "reject" ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <>
                        <Ionicons name="close" size={18} color="#ef4444" />
                        <Text style={styles.rejectButtonText}>Reject</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.approveButton, { backgroundColor: "#22c55e" }]}
                    onPress={() => confirmAndRun(
                      "Approve",
                      `"${broadcast.title}" will be ready to send to ${broadcast.targetUserCount} users.`,
                      "approve",
                      approveMutation,
                      "Broadcast approved.",
                    )}
                    disabled={loading !== null}
                  >
                    {loading === "approve" ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text style={styles.approveButtonText}>Approve</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Approved: Send Now */}
              {broadcast.status === "approved" && (
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: DEFAULT_PRIMARY_COLOR }]}
                  onPress={() => confirmAndRun(
                    "Send Now",
                    `Send "${broadcast.title}" to ${broadcast.targetUserCount} users? This cannot be undone.`,
                    "send",
                    sendMutation,
                    "Broadcast is being delivered.",
                  )}
                  disabled={loading !== null}
                >
                  {loading === "send" ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#fff" />
                      <Text style={styles.primaryButtonText}>Send Now</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Sent: Read-only confirmation */}
              {broadcast.status === "sent" && (
                <View style={[styles.sentBanner, { backgroundColor: "#eff6ff" }]}>
                  <Ionicons name="checkmark-circle" size={20} color="#3b82f6" />
                  <Text style={styles.sentText}>This broadcast has been sent</Text>
                </View>
              )}

              {/* Rejected: Read-only */}
              {broadcast.status === "rejected" && (
                <View style={[styles.sentBanner, { backgroundColor: "#fef2f2" }]}>
                  <Ionicons name="close-circle" size={20} color="#ef4444" />
                  <Text style={[styles.sentText, { color: "#ef4444" }]}>This broadcast was rejected</Text>
                </View>
              )}

              {/* Delete — draft or rejected only */}
              {(broadcast.status === "draft" || broadcast.status === "rejected") && (
                <TouchableOpacity
                  style={[styles.outlineButton, { borderColor: "#ef4444", marginTop: 4 }]}
                  onPress={() => confirmAndRun(
                    "Delete",
                    `Delete "${broadcast.title}"? This cannot be undone.`,
                    "delete",
                    deleteMutation,
                    "Broadcast deleted.",
                    true,
                  )}
                  disabled={loading !== null}
                >
                  {loading === "delete" ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      <Text style={[styles.outlineButtonText, { color: "#ef4444" }]}>Delete</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function MetaRow({ icon, label, value, colors }: { icon: string; label: string; value: string; colors: any }) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
      <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
    minHeight: "50%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  body: {},
  bodyContent: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  metaSection: {
    borderTopWidth: 1,
    paddingTop: 16,
    gap: 10,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaLabel: {
    fontSize: 13,
    width: 80,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  actions: {
    gap: 10,
  },
  outlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  waitingText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 8,
  },
  approvalRow: {
    flexDirection: "row",
    gap: 10,
  },
  rejectButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  rejectButtonText: {
    color: "#ef4444",
    fontWeight: "600",
  },
  approveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
  },
  approveButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  sentBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 10,
  },
  sentText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#3b82f6",
  },
});
