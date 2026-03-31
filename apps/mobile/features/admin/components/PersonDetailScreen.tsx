/**
 * PersonDetailScreen - Detailed view of a community member.
 *
 * Displays comprehensive information about a member including:
 * - Profile info
 * - Admin role management (for Primary Admins)
 * - Account activity
 * - Group memberships
 * - Attendance records and stats
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
  Modal,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { formatDistanceToNow, format } from "date-fns";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@/providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { formatError } from "@/utils/error-handling";

// Role constants (matching backend)
const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

export function PersonDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ user_id: string }>();
  // The user_id param is now a Convex ID string
  const userId = params.user_id || null;
  const { user: currentUser, community, refreshUser, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [editingAttendance, setEditingAttendance] = useState<{
    meetingId: string;
    groupId: string;
    groupName: string;
    meetingDate: string | number;
    currentPresent: boolean;
  } | null>(null);
  const [isUpdatingAttendance, setIsUpdatingAttendance] = useState(false);

  // Fetch member details using Convex
  const rawMember = useQuery(
    api.functions.admin.members.getCommunityMemberById,
    community?.id && userId && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          targetUserId: userId as Id<"users">,
        }
      : "skip"
  );

  const isLoading = rawMember === undefined;

  // Transform raw data to component format
  const member = rawMember
    ? {
        user_id: rawMember.id,
        first_name: rawMember.firstName,
        last_name: rawMember.lastName,
        email: rawMember.email,
        phone: rawMember.phone,
        profile_photo: rawMember.profilePhoto,
        last_login: rawMember.lastLogin,
        created_at: rawMember.communityMembership?.joinedAt,
        is_admin: rawMember.communityMembership?.isAdmin ?? false,
        is_primary_admin: rawMember.communityMembership?.isPrimaryAdmin ?? false,
        role: rawMember.communityMembership?.roles,
        groups: (rawMember.activeGroups || []).map((g: any) => ({
          group_id: g.groupId,
          group_name: g.groupName,
          group_type_name: g.groupTypeName,
          role: g.role,
          is_active: true,
          joined_at: g.joinedAt,
          left_at: null,
        })),
        groups_count: (rawMember.activeGroups || []).length,
        recent_attendance: (rawMember.recentAttendance || []).map((a: any) => ({
          meeting_id: a.meetingId,
          group_id: a.groupId,
          group_name: a.groupName,
          meeting_date: a.meetingScheduledAt,
          attended: a.status === 1,
          rsvp_status: null,
        })),
        total_meetings_attended: rawMember.attendance?.attended ?? 0,
        attendance_rate: rawMember.attendance?.rate ?? null,
      }
    : null;

  // Mutations
  const updateRoleMutation = useAuthenticatedMutation(api.functions.admin.members.updateMemberRole);
  const transferPrimaryAdminMutation = useAuthenticatedMutation(api.functions.admin.members.transferPrimaryAdmin);
  const removeMemberMutation = useAuthenticatedMutation(api.functions.communities.removeMember);
  const updateAttendanceMutation = useAuthenticatedMutation(api.functions.memberFollowups.updateAttendance);

  const canManageAdmins = currentUser?.is_primary_admin ?? false;
  const isCurrentUserAdmin = currentUser?.is_admin || currentUser?.is_primary_admin;
  const isSelf = currentUser?.id === userId;

  const handleAdminUpdateAttendance = useCallback(
    async (status: number) => {
      if (!editingAttendance || !userId || !community?.id) return;
      setIsUpdatingAttendance(true);
      try {
        await updateAttendanceMutation({
          groupId: editingAttendance.groupId as Id<"groups">,
          meetingId: editingAttendance.meetingId as Id<"meetings">,
          targetUserId: userId as Id<"users">,
          status,
        });
        setEditingAttendance(null);
      } catch (error: any) {
        Alert.alert("Error", formatError(error, "Failed to update attendance"));
      } finally {
        setIsUpdatingAttendance(false);
      }
    },
    [editingAttendance, userId, community?.id, updateAttendanceMutation]
  );

  const handleMakeAdmin = useCallback(async () => {
    if (!userId || !community?.id || !currentUser?.id) return;

    Alert.alert(
      "Promote to Admin",
      `Are you sure you want to make ${member?.first_name} ${member?.last_name} an Admin? They will be able to manage groups, members, and community settings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Make Admin",
          onPress: async () => {
            setIsUpdatingRole(true);
            try {
              await updateRoleMutation({
                communityId: community.id as Id<"communities">,
                targetUserId: userId as Id<"users">,
                role: COMMUNITY_ROLES.ADMIN,
              });
              Alert.alert("Success", `${member?.first_name} is now an Admin.`);
            } catch (error: any) {
              Alert.alert("Error", formatError(error, "Failed to update role"));
            } finally {
              setIsUpdatingRole(false);
            }
          },
        },
      ]
    );
  }, [userId, community?.id, currentUser?.id, member, updateRoleMutation]);

  const handleRemoveAdmin = useCallback(async () => {
    if (!userId || !community?.id || !currentUser?.id) return;

    Alert.alert(
      "Remove Admin Role",
      `Are you sure you want to remove ${member?.first_name} ${member?.last_name}'s Admin privileges? They will become a regular member.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove Admin",
          style: "destructive",
          onPress: async () => {
            setIsUpdatingRole(true);
            try {
              await updateRoleMutation({
                communityId: community.id as Id<"communities">,
                targetUserId: userId as Id<"users">,
                role: COMMUNITY_ROLES.MEMBER,
              });
              Alert.alert("Success", `${member?.first_name} is now a regular member.`);
            } catch (error: any) {
              Alert.alert("Error", formatError(error, "Failed to update role"));
            } finally {
              setIsUpdatingRole(false);
            }
          },
        },
      ]
    );
  }, [userId, community?.id, currentUser?.id, member, updateRoleMutation]);

  const handleTransferPrimaryAdmin = useCallback(() => {
    if (!userId || !community?.id || !currentUser?.id) return;

    // First confirmation
    Alert.alert(
      "Transfer Primary Admin",
      `Are you sure you want to make ${member?.first_name} ${member?.last_name} the Primary Admin of this community?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: () => {
            // Second confirmation (more serious warning)
            Alert.alert(
              "Confirm Transfer",
              "This action cannot be undone. You will be demoted to a regular Admin. Are you absolutely sure?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Transfer",
                  style: "destructive",
                  onPress: async () => {
                    setIsTransferring(true);
                    try {
                      await transferPrimaryAdminMutation({
                        communityId: community.id as Id<"communities">,
                        targetUserId: userId as Id<"users">,
                      });
                      // Refresh current user's auth context (their is_primary_admin will now be false)
                      await refreshUser();
                      // Navigate back to member list
                      router.back();
                      Alert.alert("Success", "Primary Admin role has been transferred.");
                    } catch (error: any) {
                      Alert.alert("Error", formatError(error, "Failed to transfer Primary Admin role"));
                    } finally {
                      setIsTransferring(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [userId, community?.id, currentUser?.id, member, transferPrimaryAdminMutation, refreshUser, router]);

  const handleRemoveMember = useCallback(() => {
    if (!userId || !community?.id || !currentUser?.id) return;

    Alert.alert(
      "Remove from Community",
      `Are you sure you want to remove ${member?.first_name} ${member?.last_name} from this community? They will be removed from all groups and lose access to all community content.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsRemoving(true);
            try {
              await removeMemberMutation({
                communityId: community.id as Id<"communities">,
                targetUserId: userId as Id<"users">,
              });
              Alert.alert(
                "Member Removed",
                `${member?.first_name} ${member?.last_name} has been removed from the community.`,
                [
                  {
                    text: "OK",
                    onPress: () => router.replace("/admin"),
                  },
                ]
              );
            } catch (error: any) {
              Alert.alert("Error", formatError(error, "Failed to remove member"));
            } finally {
              setIsRemoving(false);
            }
          },
        },
      ]
    );
  }, [userId, community?.id, currentUser?.id, member, removeMemberMutation, router]);

  const formatDate = (dateString: string | number | null) => {
    if (!dateString) return "N/A";
    try {
      const date = typeof dateString === "number" ? new Date(dateString) : new Date(dateString);
      return format(date, "MMM d, yyyy");
    } catch {
      return String(dateString);
    }
  };

  const formatDateTime = (dateString: string | number | null) => {
    if (!dateString) return "N/A";
    try {
      const date = typeof dateString === "number" ? new Date(dateString) : new Date(dateString);
      return format(date, "MMM d, yyyy h:mm a");
    } catch {
      return String(dateString);
    }
  };

  const formatRelativeTime = (dateString: string | number | null) => {
    if (!dateString) return "Never";
    try {
      const date = typeof dateString === "number" ? new Date(dateString) : new Date(dateString);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return String(dateString);
    }
  };

  if (isLoading || userId === null) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Member Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading member details...</Text>
        </View>
      </View>
    );
  }

  if (!member) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Member Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.text }]}>Failed to load member details</Text>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.buttonPrimary }]} onPress={() => router.back()}>
            <Text style={[styles.retryButtonText, { color: colors.buttonPrimaryText }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const fullName = `${member.first_name} ${member.last_name}`;
  const initials = `${member.first_name?.[0] || ""}${member.last_name?.[0] || ""}`;
  const activeGroups = member.groups.filter((g) => g.is_active);
  const inactiveGroups = member.groups.filter((g) => !g.is_active);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Member Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Profile Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              {member.profile_photo ? (
                <Image source={{ uri: member.profile_photo }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.profileName, { color: colors.text }]}>{fullName}</Text>
                {member.is_primary_admin && (
                  <View style={[styles.primaryAdminBadge, { backgroundColor: primaryColor }]}>
                    <Text style={styles.primaryAdminBadgeText}>Primary Admin</Text>
                  </View>
                )}
                {member.is_admin && !member.is_primary_admin && (
                  <View style={[styles.adminBadge, { backgroundColor: isDark ? 'rgba(255,152,0,0.2)' : '#FF980020' }]}>
                    <Text style={[styles.adminBadgeText, { color: isDark ? '#FFB74D' : '#FF9800' }]}>Admin</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{member.email}</Text>
              {member.phone && (
                <Text style={[styles.profilePhone, { color: colors.textSecondary }]}>{member.phone}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Account Activity Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Account Activity</Text>
          <View style={styles.infoGrid}>
            <View style={[styles.infoItem, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Last Login</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{formatRelativeTime(member.last_login)}</Text>
              {member.last_login && (
                <Text style={[styles.infoSubtext, { color: colors.textTertiary }]}>{formatDateTime(member.last_login)}</Text>
              )}
            </View>
            <View style={[styles.infoItem, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Account Created</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{formatDate(member.created_at)}</Text>
              {member.created_at && (
                <Text style={[styles.infoSubtext, { color: colors.textTertiary }]}>{formatRelativeTime(member.created_at)}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Groups Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Group Memberships</Text>
            <View style={[styles.badge, { backgroundColor: primaryColor }]}>
              <Text style={styles.badgeText}>{member.groups_count}</Text>
            </View>
          </View>

          {activeGroups.length > 0 && (
            <>
              <Text style={[styles.subsectionTitle, { color: colors.textSecondary }]}>Active Groups</Text>
              {activeGroups.map((group) => (
                <View key={group.group_id} style={[styles.groupCard, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={styles.groupInfo}>
                    <Text style={[styles.groupName, { color: colors.text }]}>{group.group_name}</Text>
                    <Text style={[styles.groupType, { color: colors.textSecondary }]}>{group.group_type_name}</Text>
                    <Text style={[styles.groupDate, { color: colors.textTertiary }]}>
                      Joined: {formatDate(group.joined_at)}
                    </Text>
                  </View>
                  <View style={[styles.roleBadge, { backgroundColor: colors.border }, group.role === "leader" && { backgroundColor: `${primaryColor}20` }]}>
                    <Text style={[styles.roleBadgeText, { color: colors.textSecondary }, group.role === "leader" && { color: primaryColor }]}>
                      {group.role}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {inactiveGroups.length > 0 && (
            <>
              <Text style={[styles.subsectionTitle, { marginTop: 16, color: colors.textSecondary }]}>Past Groups</Text>
              {inactiveGroups.map((group) => (
                <View key={group.group_id} style={[styles.groupCard, styles.groupCardInactive, { backgroundColor: colors.surfaceSecondary }]}>
                  <View style={styles.groupInfo}>
                    <Text style={[styles.groupName, { color: colors.text }]}>{group.group_name}</Text>
                    <Text style={[styles.groupType, { color: colors.textSecondary }]}>{group.group_type_name}</Text>
                    <Text style={[styles.groupDate, { color: colors.textTertiary }]}>
                      Left: {formatDate(group.left_at)}
                    </Text>
                  </View>
                  <View style={[styles.inactiveBadge, { backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : '#FF6B6B20' }]}>
                    <Text style={[styles.inactiveBadgeText, { color: colors.destructive }]}>Inactive</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {member.groups_count === 0 && (
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>Not a member of any groups</Text>
          )}
        </View>

        {/* Attendance Section */}
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Attendance</Text>
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: `${primaryColor}10` }]}>
              <Text style={[styles.statValue, { color: primaryColor }]}>{member.total_meetings_attended}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Meetings Attended</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: `${primaryColor}10` }]}>
              <Text style={[styles.statValue, { color: primaryColor }]}>
                {member.attendance_rate !== null
                  ? `${Math.round(member.attendance_rate)}%`
                  : "N/A"}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Attendance Rate</Text>
            </View>
          </View>

          {member.recent_attendance.length > 0 && (
            <>
              <Text style={[styles.subsectionTitle, { color: colors.textSecondary }]}>
                {isCurrentUserAdmin ? "Recent Attendance (tap to edit)" : "Recent Attendance"}
              </Text>
              {member.recent_attendance.map((record, index) => {
                const RowWrapper = isCurrentUserAdmin ? TouchableOpacity : View;
                const rowProps = isCurrentUserAdmin
                  ? {
                      onPress: () =>
                        setEditingAttendance({
                          meetingId: String(record.meeting_id),
                          groupId: String(record.group_id),
                          groupName: record.group_name,
                          meetingDate: record.meeting_date,
                          currentPresent: record.attended,
                        }),
                      activeOpacity: 0.7,
                    }
                  : {};
                return (
                  <RowWrapper
                    key={`${record.meeting_id}-${index}`}
                    style={[styles.attendanceCard, { backgroundColor: colors.surfaceSecondary }]}
                    {...rowProps}
                  >
                    <View style={styles.attendanceInfo}>
                      <Text style={[styles.attendanceName, { color: colors.text }]}>{record.group_name}</Text>
                      <Text style={[styles.attendanceDate, { color: colors.textSecondary }]}>
                        {formatDateTime(record.meeting_date)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.attendanceStatus,
                        {
                          backgroundColor: record.attended
                            ? isDark
                              ? "rgba(48,209,88,0.15)"
                              : "#4CAF5020"
                            : isDark
                              ? "rgba(255,69,58,0.15)"
                              : "#FF6B6B20",
                        },
                      ]}
                    >
                      <Ionicons
                        name={record.attended ? "checkmark-circle" : "close-circle"}
                        size={20}
                        color={record.attended ? colors.success : colors.destructive}
                      />
                      <Text
                        style={[
                          styles.attendanceStatusText,
                          { color: record.attended ? colors.success : colors.destructive },
                        ]}
                      >
                        {record.attended ? "Present" : "Absent"}
                      </Text>
                    </View>
                    {isCurrentUserAdmin && (
                      <Ionicons name="chevron-forward" size={16} color={colors.iconSecondary} style={{ marginLeft: 4 }} />
                    )}
                  </RowWrapper>
                );
              })}
            </>
          )}

          {member.recent_attendance.length === 0 && (
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No attendance records</Text>
          )}
        </View>

        {/* Admin Role Management Section - Only visible to Primary Admin */}
        {canManageAdmins && !isSelf && !member.is_primary_admin && (
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Admin Role</Text>
            <View style={styles.adminActions}>
              {!member.is_admin ? (
                <TouchableOpacity
                  style={[styles.promoteButton, { backgroundColor: primaryColor }]}
                  onPress={handleMakeAdmin}
                  disabled={isUpdatingRole}
                >
                  {isUpdatingRole ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="shield-checkmark" size={20} color="#fff" />
                      <Text style={styles.promoteButtonText}>Make Admin</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.demoteButton, { borderColor: colors.destructive }]}
                  onPress={handleRemoveAdmin}
                  disabled={isUpdatingRole}
                >
                  {isUpdatingRole ? (
                    <ActivityIndicator size="small" color={colors.destructive} />
                  ) : (
                    <>
                      <Ionicons name="shield-outline" size={20} color={colors.destructive} />
                      <Text style={[styles.demoteButtonText, { color: colors.destructive }]}>Remove Admin</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.adminHelpText, { color: colors.textSecondary }]}>
              {member.is_admin
                ? "This member is currently an Admin and can manage groups, members, and settings."
                : "Promote this member to Admin to give them access to manage groups, members, and settings."}
            </Text>

            {/* Transfer Primary Admin Section */}
            <View style={[styles.transferSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.transferSectionTitle, { color: colors.textSecondary }]}>Transfer Ownership</Text>
              <TouchableOpacity
                style={[styles.transferButton, { backgroundColor: `${primaryColor}10`, borderColor: primaryColor }]}
                onPress={handleTransferPrimaryAdmin}
                disabled={isTransferring}
              >
                {isTransferring ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <>
                    <Ionicons name="swap-horizontal" size={20} color={primaryColor} />
                    <Text style={[styles.transferButtonText, { color: primaryColor }]}>Transfer Primary Admin to this Member</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.transferHelpText, { color: colors.textTertiary }]}>
                This will make {member.first_name} the Primary Admin. You will be demoted to a regular Admin. This action cannot be undone.
              </Text>
            </View>
          </View>
        )}

        {/* Remove from Community Section
            - Primary admin: can remove anyone except themselves
            - Regular admin: can only remove regular members (not other admins) */}
        {isCurrentUserAdmin && !isSelf && (canManageAdmins ? !member.is_primary_admin : !member.is_admin) && (
          <View style={[styles.dangerSection, { backgroundColor: colors.surface, borderColor: isDark ? 'rgba(255,69,58,0.2)' : '#FF6B6B30' }]}>
            <Text style={[styles.dangerSectionTitle, { color: colors.destructive }]}>Danger Zone</Text>
            <TouchableOpacity
              style={[styles.removeButton, { backgroundColor: colors.destructive }]}
              onPress={handleRemoveMember}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="person-remove" size={20} color="#fff" />
                  <Text style={styles.removeButtonText}>Remove from Community</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={[styles.dangerHelpText, { color: colors.textTertiary }]}>
              This will remove {member.first_name} from all groups in this community and revoke their access. This action cannot be undone.
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!editingAttendance}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingAttendance(null)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.45)" }]}
          onPress={() => setEditingAttendance(null)}
        >
          <Pressable style={[styles.modalCard, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit attendance</Text>
            {editingAttendance && (
              <>
                <Text style={[styles.modalSubtitle, { color: colors.text }]} numberOfLines={2}>
                  {editingAttendance.groupName}
                </Text>
                <Text style={[styles.modalMeta, { color: colors.textSecondary }]}>
                  {formatDateTime(editingAttendance.meetingDate)}
                </Text>
                <Text style={[styles.modalCurrent, { color: colors.textSecondary }]}>
                  Current: {editingAttendance.currentPresent ? "Present" : "Absent"}
                </Text>
                <TouchableOpacity
                  style={[styles.modalOptionBtn, { backgroundColor: colors.success }]}
                  onPress={() => handleAdminUpdateAttendance(1)}
                  disabled={isUpdatingAttendance}
                >
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={styles.modalOptionText}>Mark present</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOptionBtn, { backgroundColor: colors.destructive }]}
                  onPress={() => handleAdminUpdateAttendance(0)}
                  disabled={isUpdatingAttendance}
                >
                  <Ionicons name="close-circle" size={22} color="#fff" />
                  <Text style={styles.modalOptionText}>Mark absent</Text>
                </TouchableOpacity>
                {isUpdatingAttendance && <ActivityIndicator size="small" color={primaryColor} style={{ marginTop: 12 }} />}
              </>
            )}
            <TouchableOpacity style={styles.modalCancelWrap} onPress={() => setEditingAttendance(null)}>
              <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  headerSpacer: {
    width: 32,
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
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: "bold",
  },
  profileEmail: {
    fontSize: 15,
    marginTop: 4,
  },
  profilePhone: {
    fontSize: 15,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoGrid: {
    flexDirection: "row",
    gap: 12,
  },
  infoItem: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  infoSubtext: {
    fontSize: 11,
    marginTop: 2,
  },
  groupCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  groupCardInactive: {
    opacity: 0.6,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 15,
    fontWeight: "600",
  },
  groupType: {
    fontSize: 13,
    marginTop: 2,
  },
  groupDate: {
    fontSize: 12,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    textTransform: "capitalize",
  },
  inactiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  inactiveBadgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "bold",
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  attendanceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  attendanceInfo: {
    flex: 1,
  },
  attendanceName: {
    fontSize: 14,
    fontWeight: "500",
  },
  attendanceDate: {
    fontSize: 12,
    marginTop: 2,
  },
  attendanceStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  attendanceStatusText: {
    fontSize: 12,
    fontWeight: "500",
  },
  emptyText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    padding: 20,
  },
  // Admin role management styles
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryAdminBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  primaryAdminBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  adminBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  adminActions: {
    marginBottom: 12,
  },
  promoteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  promoteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  demoteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  demoteButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  adminHelpText: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Transfer Primary Admin styles
  transferSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  transferSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  transferButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  transferButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  transferHelpText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
    fontStyle: "italic",
  },
  // Danger zone / Remove from community styles
  dangerSection: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  dangerSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  removeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  dangerHelpText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  modalMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  modalCurrent: {
    fontSize: 13,
    marginTop: 12,
    marginBottom: 16,
  },
  modalOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
  modalOptionText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalCancelWrap: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  modalCancelText: {
    fontSize: 16,
  },
});
