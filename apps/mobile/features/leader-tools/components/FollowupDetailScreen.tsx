import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Linking,
  Alert,
  Modal,
  Pressable,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { useContactConfirmation } from "@features/chat/hooks/useContactConfirmation";

type SnoozeDuration = "1_week" | "2_weeks" | "1_month" | "3_months";

const SNOOZE_OPTIONS: { value: SnoozeDuration; label: string }[] = [
  { value: "1_week", label: "1 week" },
  { value: "2_weeks", label: "2 weeks" },
  { value: "1_month", label: "1 month" },
  { value: "3_months", label: "3 months" },
];

/**
 * Reusable detail content component — used by both the full-screen route
 * and the desktop side sheet panel.
 */
export function FollowupDetailContent({
  groupId,
  memberId,
  onClose,
  scrollToNotes,
  scrollToTasks,
}: {
  groupId: string;
  memberId: string;
  onClose?: () => void;
  scrollToNotes?: boolean;
  scrollToTasks?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const { primaryColor } = useCommunityTheme();

  const [noteText, setNoteText] = useState("");
  const [showSnoozeModal, setShowSnoozeModal] = useState(false);
  const [snoozeNote, setSnoozeNote] = useState("");
  const [showImageModal, setShowImageModal] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const [notesSectionY, setNotesSectionY] = useState(0);
  const [editingMeeting, setEditingMeeting] = useState<{
    meetingId: string;
    title: string;
    date: string;
    currentStatus: number;
    groupId?: string;
  } | null>(null);
  const [isAddingFollowup, setIsAddingFollowup] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [isUpdatingAttendance, setIsUpdatingAttendance] = useState(false);

  // Tasks section
  const [tasksSectionY, setTasksSectionY] = useState(0);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState<string | null>(null);
  const [assigneeSearchText, setAssigneeSearchText] = useState("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Reset local state when switching between members (desktop side-sheet reuses component)
  useEffect(() => {
    setNoteText("");
    setSnoozeNote("");
    setShowSnoozeModal(false);
    setShowImageModal(false);
    setEditingMeeting(null);
    setNotesSectionY(0);
    setIsAddingFollowup(false);
    setIsSnoozing(false);
    setIsUpdatingAttendance(false);
    setTasksSectionY(0);
    setShowCreateTaskModal(false);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskAssigneeId(null);
    setAssigneeSearchText("");
    setIsCreatingTask(false);
    setSelectedTags([]);
    setTagInput("");
  }, [memberId]);

  const group_id = groupId;
  const member_id = memberId;

  // Fetch member history using Convex
  const historyData = useAuthenticatedQuery(
    api.functions.communityPeople.history,
    member_id
      ? {
          communityPeopleId: member_id as Id<"communityPeople">,
          currentUserId: currentUserId,
        }
      : "skip"
  );

  // Fetch all group tasks — used for member tasks + tag autocomplete
  const groupTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const memberTasks = useMemo(() => {
    if (!groupTasks || !historyData?.member?.odUserId) return undefined;
    const targetId = historyData.member.odUserId;
    return (groupTasks as any[]).filter(
      (t) => t.targetMemberId === targetId && (t.status === "open" || t.status === "snoozed")
    );
  }, [groupTasks, historyData?.member?.odUserId]);

  // Fetch assignable leaders for task creation
  const assignableLeaders = useAuthenticatedQuery(
    api.functions.tasks.index.searchAssignableLeaders,
    groupId && assigneeSearchText.length >= 1
      ? {
          groupId: groupId as Id<"groups">,
          searchText: assigneeSearchText,
        }
      : "skip"
  );

  const allLeaders = useAuthenticatedQuery(
    api.functions.tasks.index.listAssignableLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const createTaskMutation = useAuthenticatedMutation(api.functions.tasks.index.create);

  const availableTags = useMemo(() => {
    if (!groupTasks) return [];
    return [...new Set((groupTasks as any[]).flatMap((t) => t.tags ?? []))].sort();
  }, [groupTasks]);

  const filteredTagSuggestions = useMemo(() => {
    const input = tagInput.trim().toLowerCase();
    if (!input) return [];
    return availableTags.filter(
      (tag) => tag.includes(input) && !selectedTags.includes(tag)
    );
  }, [tagInput, availableTags, selectedTags]);

  const handleAddTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase().replace(/\s+/g, "_");
    if (normalized && !selectedTags.includes(normalized)) {
      setSelectedTags((prev) => [...prev, normalized]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  const isLoading = historyData === undefined;
  const refetch = () => {}; // Convex auto-updates

  // Transform data for backward compatibility
  const history = useMemo(() => {
    if (!historyData) return undefined;
    return {
      member: {
        ...historyData.member,
        profileImage: historyData.member.profileImage,
        joinedAt: historyData.member.joinedAt ? new Date(historyData.member.joinedAt).toISOString() : null,
      },
      attendanceHistory: historyData.attendanceHistory.map((a: any) => ({
        meetingId: a.meetingId,
        title: a.title,
        date: new Date(a.date).toISOString(),
        status: a.status,
      })),
      followups: historyData.followups.map((f: any) => ({
        id: f.id,
        type: f.type,
        content: f.content,
        snoozeUntil: f.snoozeUntil ? new Date(f.snoozeUntil).toISOString() : null,
        createdAt: new Date(f.createdAt).toISOString(),
        createdBy: f.createdBy,
      })),
      isSnoozed: historyData.isSnoozed,
      snoozedUntil: historyData.snoozedUntil ? new Date(historyData.snoozedUntil).toISOString() : null,
      scoreBreakdown: historyData.scoreBreakdown,
      crossGroupAttendance: historyData.crossGroupAttendance ?? [],
      servingHistory: historyData.servingHistory ?? [],
      toolDisplayName: historyData.toolDisplayName ?? "People",
      triggeredAlerts: historyData.triggeredAlerts ?? [],
    };
  }, [historyData]);

  // Convex mutations (auto-inject token)
  const addFollowup = useAuthenticatedMutation(api.functions.communityPeople.addFollowup);
  const snoozeMember = useAuthenticatedMutation(api.functions.communityPeople.snooze);
  const updateAttendance = useAuthenticatedMutation(api.functions.memberFollowups.updateAttendance);
  const deleteFollowupMut = useAuthenticatedMutation(api.functions.memberFollowups.deleteFollowup);

  // Confirmation hook — logs action only after user confirms they completed it
  const { setPendingAction } = useContactConfirmation({
    onConfirm: (type) => {
      addFollowupMutation.mutate({
        communityPeopleId: member_id || "",
        type,
        content: type === "call" ? "Made a phone call" : "Sent a text message",
      });
    },
  });

  // Mutation wrapper objects for backward compatibility
  const addFollowupMutation = {
    mutate: async (args: { communityPeopleId: string; type: string; content?: string }) => {
      setIsAddingFollowup(true);
      try {
        await addFollowup({
          communityPeopleId: args.communityPeopleId as Id<"communityPeople">,
          type: args.type as "note" | "call" | "text" | "followed_up",
          content: args.content,
        });
        setNoteText("");
        // Convex auto-updates reactive queries
      } catch (err: any) {
        Alert.alert("Error", err.message || "Failed to add note");
      } finally {
        setIsAddingFollowup(false);
      }
    },
    isPending: isAddingFollowup,
  };

  const snoozeMutation = {
    mutate: async (args: { communityPeopleId: string; duration: SnoozeDuration; note?: string }) => {
      setIsSnoozing(true);
      try {
        await snoozeMember({
          communityPeopleId: args.communityPeopleId as Id<"communityPeople">,
          duration: args.duration,
          note: args.note,
        });
        setShowSnoozeModal(false);
        setSnoozeNote("");
        Alert.alert("Success", "Member has been snoozed");
      } catch (err: any) {
        Alert.alert("Error", err.message || "Failed to snooze member");
      } finally {
        setIsSnoozing(false);
      }
    },
    isPending: isSnoozing,
  };

  const updateAttendanceMutation = {
    mutate: async (args: { groupId: string; meetingId: string; targetUserId: string; status: number }) => {
      setIsUpdatingAttendance(true);
      try {
        await updateAttendance({
          groupId: args.groupId as Id<"groups">,
          meetingId: args.meetingId as Id<"meetings">,
          targetUserId: args.targetUserId as Id<"users">,
          status: args.status,
        });
        setEditingMeeting(null);
      } catch (err: any) {
        Alert.alert("Error", err.message || "Failed to update attendance");
      } finally {
        setIsUpdatingAttendance(false);
      }
    },
    isPending: isUpdatingAttendance,
  };

  const handleBack = () => {
    if (onClose) {
      onClose();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${group_id}/followup`);
    }
  };

  const handleCall = () => {
    if (history?.member.phone) {
      Linking.openURL(`tel:${history.member.phone}`);
      // Confirmation dialog appears when user returns to app
      const name = `${history.member.firstName} ${history.member.lastName}`.trim();
      setPendingAction("call", name);
    }
  };

  const handleText = () => {
    if (history?.member.phone) {
      Linking.openURL(`sms:${history.member.phone}`);
      // Confirmation dialog appears when user returns to app
      const name = `${history.member.firstName} ${history.member.lastName}`.trim();
      setPendingAction("text", name);
    }
  };

  const handleMarkFollowedUp = () => {
    addFollowupMutation.mutate({
      communityPeopleId: member_id || "",
      type: "followed_up",
      content: "Marked as followed up",
    });
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addFollowupMutation.mutate({
      communityPeopleId: member_id || "",
      type: "note",
      content: noteText.trim(),
    });
  };

  const handleSnooze = (duration: SnoozeDuration) => {
    snoozeMutation.mutate({
      communityPeopleId: member_id || "",
      duration,
      note: snoozeNote.trim() || undefined,
    });
  };

  const handleUpdateAttendance = (newStatus: number) => {
    if (!editingMeeting || !history) return;
    updateAttendanceMutation.mutate({
      groupId: editingMeeting.groupId || group_id || "",
      meetingId: editingMeeting.meetingId,
      targetUserId: history.member.odUserId, // Use Convex user ID
      status: newStatus,
    });
  };

  const handleDeleteFollowup = (followupId: string) => {
    Alert.alert(
      "Delete Entry",
      "Are you sure you want to delete this entry?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteFollowupMut({
                followupId: followupId as Id<"memberFollowups">,
              });
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete entry");
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatRawValue = (variableId: string, rawValue: number): string => {
    switch (variableId) {
      case "attendance_pct":
      case "attendance_all_groups_pct":
        return `${rawValue}%`;
      case "consecutive_missed":
        return `${rawValue} missed`;
      case "days_since_last_followup":
      case "days_since_last_text":
      case "days_since_last_call":
      case "days_since_last_in_person":
        return rawValue >= 999 ? "Never" : `${rawValue} days`;
      case "pco_services_past_2mo":
        return `${rawValue} services`;
      default:
        return `${rawValue}`;
    }
  };

  const getScoreColor = (value: number): string => {
    if (value >= 70) return "#4CAF50";
    if (value >= 40) return "#FF9500";
    return "#FF6B6B";
  };

  const getFollowupIcon = (type: string) => {
    switch (type) {
      case "note":
        return "document-text-outline";
      case "call":
        return "call-outline";
      case "text":
        return "chatbubble-outline";
      case "snooze":
        return "time-outline";
      case "followed_up":
        return "checkmark-circle-outline";
      case "reach_out":
        return "hand-left-outline";
      case "email":
        return "mail-outline";
      default:
        return "ellipse-outline";
    }
  };

  const getFollowupColor = (type: string) => {
    switch (type) {
      case "note":
        return "#007AFF";
      case "call":
        return "#34C759";
      case "text":
        return "#5856D6";
      case "email":
        return "#FF6B6B";
      case "snooze":
        return "#FF9500";
      case "followed_up":
        return "#4CAF50";
      case "reach_out":
        return "#8E44AD";
      default:
        return "#666";
    }
  };

  // Auto-scroll to the notes section when opened from the desktop table notes cell
  useEffect(() => {
    if (scrollToNotes && history && notesSectionY > 0) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: notesSectionY, animated: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [scrollToNotes, history, notesSectionY]);

  // Auto-scroll to the tasks section when opened from the desktop table tasks cell
  useEffect(() => {
    if (scrollToTasks && history && tasksSectionY > 0) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: tasksSectionY, animated: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [scrollToTasks, history, tasksSectionY]);

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !historyData?.member?.odUserId) return;
    setIsCreatingTask(true);
    try {
      await createTaskMutation({
        groupId: groupId as Id<"groups">,
        title: newTaskTitle.trim(),
        description: newTaskDescription.trim() || undefined,
        targetType: "member",
        targetMemberId: historyData.member.odUserId as Id<"users">,
        assignedToId: newTaskAssigneeId
          ? (newTaskAssigneeId as Id<"users">)
          : undefined,
        responsibilityType: newTaskAssigneeId ? "person" : "group",
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      setShowCreateTaskModal(false);
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskAssigneeId(null);
      setAssigneeSearchText("");
      setSelectedTags([]);
      setTagInput("");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create task");
    } finally {
      setIsCreatingTask(false);
    }
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "#3B82F6";
      case "snoozed":
        return "#F59E0B";
      case "done":
        return "#10B981";
      case "canceled":
        return "#6B7280";
      default:
        return "#6B7280";
    }
  };


  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading member details...</Text>
        </View>
      </View>
    );
  }

  if (!history) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
          <Text style={styles.errorText}>
            Failed to load member details
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const { member, attendanceHistory, followups } = history;

  return (
    <>
      {/* Header */}
      <View style={[styles.header, !onClose && { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name={onClose ? "close" : "arrow-back"} size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{history?.toolDisplayName ?? "People"}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView ref={scrollViewRef} style={styles.content}>
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <TouchableOpacity
            onPress={() => member.profileImage && setShowImageModal(true)}
            activeOpacity={member.profileImage ? 0.8 : 1}
          >
            {member.profileImage ? (
              <Image
                source={{ uri: member.profileImage }}
                style={styles.profileImage}
              />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Text style={styles.profileInitials}>
                  {member.firstName.charAt(0).toUpperCase()}
                  {member.lastName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.profileName}>
            {member.firstName} {member.lastName}
          </Text>
          {member.joinedAt && (
            <Text style={styles.profileJoined}>
              Member since {formatDate(member.joinedAt)}
            </Text>
          )}
        </View>

        {/* Image Modal */}
        <Modal
          visible={showImageModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageModal(false)}
        >
          <Pressable
            style={styles.imageModalOverlay}
            onPress={() => setShowImageModal(false)}
          >
            <View style={styles.imageModalContainer}>
              {member.profileImage && (
                <Image
                  source={{ uri: member.profileImage }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              )}
              <TouchableOpacity
                style={styles.imageModalClose}
                onPress={() => setShowImageModal(false)}
              >
                <Ionicons name="close-circle" size={36} color="#fff" />
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>


        {/* Alerts */}
        {history.triggeredAlerts.length > 0 && (
          <View style={styles.alertSection}>
            <View style={styles.alertHeader}>
              <Ionicons name="warning" size={20} color="#DC2626" />
              <Text style={styles.alertSectionTitle}>Alerts</Text>
            </View>
            {history.triggeredAlerts.map((label: string, i: number) => (
              <View key={i} style={styles.alertItem}>
                <Ionicons name="alert-circle" size={16} color="#DC2626" />
                <Text style={styles.alertItemText}>{label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Scores */}
        {history.scoreBreakdown && history.scoreBreakdown.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scores</Text>
            <View style={styles.scoresContainer}>
              {history.scoreBreakdown.map((score: any) => (
                <View key={score.id} style={styles.scoreCard}>
                  <View style={styles.scoreHeader}>
                    <Text style={styles.scoreName}>{score.name}</Text>
                    <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(score.value) }]}>
                      <Text style={styles.scoreBadgeText}>{score.value}</Text>
                    </View>
                  </View>
                  <View style={styles.scoreVariables}>
                    {score.variables.map((variable: any) => (
                      <View key={variable.id} style={styles.variableRow}>
                        <View style={styles.variableLabelRow}>
                          <Text style={styles.variableLabel}>{variable.label}</Text>
                          <Text style={styles.variableRaw}>
                            {formatRawValue(variable.id, variable.rawValue)}
                          </Text>
                        </View>
                        <View style={styles.variableBarContainer}>
                          <View
                            style={[
                              styles.variableBar,
                              {
                                width: `${Math.max(2, variable.normalizedValue)}%`,
                                backgroundColor: getScoreColor(variable.normalizedValue),
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.variableHint}>
                          {variable.normHint}
                          {score.variables.length > 1 ? ` · weight: ${variable.weight}` : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, !member.phone && styles.quickActionDisabled]}
              onPress={handleCall}
              disabled={!member.phone || addFollowupMutation.isPending}
            >
              <Ionicons
                name="call"
                size={24}
                color={member.phone ? "#34C759" : "#ccc"}
              />
              <Text
                style={[
                  styles.quickActionText,
                  !member.phone && styles.quickActionTextDisabled,
                ]}
              >
                Call
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.quickAction, !member.phone && styles.quickActionDisabled]}
              onPress={handleText}
              disabled={!member.phone || addFollowupMutation.isPending}
            >
              <Ionicons
                name="chatbubble"
                size={24}
                color={member.phone ? "#5856D6" : "#ccc"}
              />
              <Text
                style={[
                  styles.quickActionText,
                  !member.phone && styles.quickActionTextDisabled,
                ]}
              >
                Text
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickAction}
              onPress={handleMarkFollowedUp}
              disabled={addFollowupMutation.isPending}
            >
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.quickActionText}>Done</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickAction}
              onPress={() => setShowSnoozeModal(true)}
            >
              <Ionicons name="time" size={24} color="#FF9500" />
              <Text style={styles.quickActionText}>Snooze</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Contact Info */}
        {(member.phone || member.email) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            {member.phone && (
              <Text style={styles.contactText}>{member.phone}</Text>
            )}
            {member.email && (
              <Text style={styles.contactText}>{member.email}</Text>
            )}
          </View>
        )}

        {/* Attendance Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance</Text>

          {/* Stats Grid */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {attendanceHistory.filter((m) => m.status === 1).length}
              </Text>
              <Text style={styles.statLabel}>Meetings Attended</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {attendanceHistory.length > 0
                  ? `${Math.round(
                      (attendanceHistory.filter((m) => m.status === 1).length /
                        attendanceHistory.length) *
                        100
                    )}%`
                  : "N/A"}
              </Text>
              <Text style={styles.statLabel}>Attendance Rate</Text>
            </View>
          </View>

          {/* Recent Attendance List */}
          {attendanceHistory.length === 0 ? (
            <Text style={styles.noAttendanceText}>
              No meetings recorded yet
            </Text>
          ) : (
            <>
              <Text style={styles.subsectionTitle}>Recent Meetings (tap to edit)</Text>
              <View style={styles.attendanceList}>
                {attendanceHistory.slice(0, 20).map((meeting) => (
                  <TouchableOpacity
                    key={meeting.meetingId}
                    style={styles.attendanceRow}
                    onPress={() => setEditingMeeting({
                      meetingId: meeting.meetingId,
                      title: meeting.title || '',
                      date: meeting.date,
                      currentStatus: meeting.status,
                    })}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={meeting.status === 1 ? "checkmark-circle" : "close-circle"}
                      size={24}
                      color={meeting.status === 1 ? "#4CAF50" : "#FF6B6B"}
                    />
                    <View style={styles.attendanceRowText}>
                      <Text style={styles.attendanceMeetingTitle} numberOfLines={1}>
                        {meeting.title || "Meeting"}
                      </Text>
                      <Text style={styles.attendanceMeetingDate}>
                        {formatShortDate(meeting.date)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#ccc" />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Cross-Group Attendance */}
        {history.crossGroupAttendance.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other Group Attendance</Text>
            {history.crossGroupAttendance.map((group: any) => (
              <View key={group.groupId} style={styles.crossGroupSection}>
                <Text style={styles.crossGroupName}>{group.groupName}</Text>
                <View style={styles.attendanceList}>
                  {group.meetings.map((meeting: any) => (
                    <TouchableOpacity
                      key={meeting.meetingId}
                      style={styles.attendanceRow}
                      onPress={() =>
                        group.canEdit &&
                        setEditingMeeting({
                          meetingId: meeting.meetingId,
                          title: meeting.title || "",
                          date: new Date(meeting.date).toISOString(),
                          currentStatus: meeting.status,
                          groupId: group.groupId,
                        })
                      }
                      activeOpacity={group.canEdit ? 0.7 : 1}
                      disabled={!group.canEdit}
                    >
                      <Ionicons
                        name={meeting.status === 1 ? "checkmark-circle" : "close-circle"}
                        size={24}
                        color={meeting.status === 1 ? "#4CAF50" : "#FF6B6B"}
                      />
                      <View style={styles.attendanceRowText}>
                        <Text style={styles.attendanceMeetingTitle} numberOfLines={1}>
                          {meeting.title || "Meeting"}
                        </Text>
                        <Text style={styles.attendanceMeetingDate}>
                          {formatShortDate(new Date(meeting.date).toISOString())}
                        </Text>
                      </View>
                      {group.canEdit && (
                        <Ionicons name="chevron-forward" size={16} color="#ccc" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Serving History */}
        {history.servingHistory.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Serving History</Text>
            <View style={styles.servingList}>
              {history.servingHistory.map((entry: any, index: number) => (
                <View key={`${entry.date}-${entry.teamName}-${index}`} style={styles.servingRow}>
                  <View style={styles.servingIcon}>
                    <Ionicons name="hand-left-outline" size={16} color="#666" />
                  </View>
                  <View style={styles.servingInfo}>
                    <Text style={styles.servingTitle}>
                      {formatShortDate(new Date(entry.date).toISOString())}{" "}
                      {entry.serviceTypeName}{entry.teamName ? ` ${entry.teamName}` : ""}
                    </Text>
                    {entry.position && (
                      <Text style={styles.servingPosition}>{entry.position}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Associated Tasks */}
        <View
          style={styles.section}
          onLayout={(e) => setTasksSectionY(e.nativeEvent.layout.y)}
        >
          <Text style={styles.sectionTitle}>Associated Tasks</Text>
          {memberTasks === undefined ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : memberTasks.length === 0 ? (
            <Text style={styles.emptyTimeline}>No tasks associated with this member</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {memberTasks.map((task: any) => (
                <TouchableOpacity
                  key={task._id}
                  style={styles.taskCard}
                  onPress={() =>
                    router.push(
                      `/(user)/leader-tools/${task.groupId}/tasks/${task._id}` as any
                    )
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.taskCardHeader}>
                    <Text style={styles.taskCardTitle} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <View
                      style={[
                        styles.taskStatusBadge,
                        { backgroundColor: getTaskStatusColor(task.status) + "20" },
                      ]}
                    >
                      <View
                        style={[
                          styles.taskStatusDot,
                          { backgroundColor: getTaskStatusColor(task.status) },
                        ]}
                      />
                      <Text
                        style={[
                          styles.taskStatusText,
                          { color: getTaskStatusColor(task.status) },
                        ]}
                      >
                        {task.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.taskCardAssignee}>
                    {task.assignedToName ?? "Unassigned"}
                  </Text>
                  {task.tags && task.tags.length > 0 && (
                    <View style={styles.taskCardTagsRow}>
                      {task.tags.map((tag: string) => (
                        <View key={tag} style={styles.taskCardTagChip}>
                          <Text style={styles.taskCardTagText}>#{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {task.groupId !== groupId && task.groupName && (
                    <Text style={styles.taskCardGroup}>{task.groupName}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity
            style={styles.addTaskButton}
            onPress={() => setShowCreateTaskModal(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color={primaryColor} />
            <Text style={[styles.addTaskButtonText, { color: primaryColor }]}>
              Add Task
            </Text>
          </TouchableOpacity>
        </View>

        {/* Add Note */}
        <View style={styles.section} onLayout={(e) => setNotesSectionY(e.nativeEvent.layout.y)}>
          <Text style={styles.sectionTitle}>Add Note</Text>
          <TextInput
            style={styles.noteInput}
            placeholder="Add a note..."
            value={noteText}
            onChangeText={setNoteText}
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity
            style={[
              styles.addNoteButton,
              (!noteText.trim() || addFollowupMutation.isPending) &&
                styles.addNoteButtonDisabled,
            ]}
            onPress={handleAddNote}
            disabled={!noteText.trim() || addFollowupMutation.isPending}
          >
            {addFollowupMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.addNoteButtonText}>Add Note</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* People History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>People History</Text>
          {followups.length === 0 ? (
            <Text style={styles.emptyTimeline}>No entries recorded yet</Text>
          ) : (
            <View style={styles.timeline}>
              {followups.map((entry, index) => (
                <View key={entry.id} style={styles.timelineItem}>
                  <View
                    style={[
                      styles.timelineIcon,
                      { backgroundColor: getFollowupColor(entry.type) },
                    ]}
                  >
                    <Ionicons
                      name={getFollowupIcon(entry.type) as any}
                      size={16}
                      color="#fff"
                    />
                  </View>
                  {index < followups.length - 1 && (
                    <View style={styles.timelineLine} />
                  )}
                  <View style={styles.timelineContent}>
                    <View style={styles.timelineHeader}>
                      <Text style={styles.timelineType}>
                        {entry.type.charAt(0).toUpperCase() + entry.type.slice(1).replace("_", " ")}
                      </Text>
                      {entry.createdBy?.id === currentUserId && (
                        <TouchableOpacity
                          onPress={() => handleDeleteFollowup(entry.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                        </TouchableOpacity>
                      )}
                    </View>
                    {entry.content && (
                      <Text style={styles.timelineNote}>{entry.content}</Text>
                    )}
                    <Text style={styles.timelineMeta}>
                      {entry.createdBy?.firstName} {entry.createdBy?.lastName} -{" "}
                      {formatDate(entry.createdAt)} at {formatTime(entry.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Snooze Modal */}
      <Modal
        visible={showSnoozeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSnoozeModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowSnoozeModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Snooze Member</Text>
            <Text style={styles.modalSubtitle}>
              How long should we hide this member from the people list?
            </Text>

            <TextInput
              style={styles.snoozeNoteInput}
              placeholder="Add a note (optional)..."
              value={snoozeNote}
              onChangeText={setSnoozeNote}
            />

            <View style={styles.snoozeOptions}>
              {SNOOZE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.snoozeOption}
                  onPress={() => handleSnooze(option.value)}
                  disabled={snoozeMutation.isPending}
                >
                  <Text style={styles.snoozeOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowSnoozeModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Edit Attendance Modal */}
      <Modal
        visible={!!editingMeeting}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingMeeting(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setEditingMeeting(null)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Attendance</Text>
            {editingMeeting && (
              <>
                <Text style={styles.attendanceModalMeeting}>
                  {editingMeeting.title || "Meeting"}
                </Text>
                <Text style={styles.attendanceModalDate}>
                  {formatDate(editingMeeting.date)}
                </Text>

                <Text style={styles.attendanceModalCurrentStatus}>
                  Current: {editingMeeting.currentStatus === 1 ? "Present ✓" : "Absent ✗"}
                </Text>

                <View style={styles.attendanceModalOptions}>
                  <TouchableOpacity
                    style={[
                      styles.attendanceModalOption,
                      styles.attendanceModalPresent,
                      editingMeeting.currentStatus === 1 && styles.attendanceModalOptionActive,
                    ]}
                    onPress={() => handleUpdateAttendance(1)}
                    disabled={updateAttendanceMutation.isPending}
                  >
                    <Ionicons name="checkmark-circle" size={24} color="#fff" />
                    <Text style={styles.attendanceModalOptionText}>Mark Present</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.attendanceModalOption,
                      styles.attendanceModalAbsent,
                      editingMeeting.currentStatus === 0 && styles.attendanceModalOptionActive,
                    ]}
                    onPress={() => handleUpdateAttendance(0)}
                    disabled={updateAttendanceMutation.isPending}
                  >
                    <Ionicons name="close-circle" size={24} color="#fff" />
                    <Text style={styles.attendanceModalOptionText}>Mark Absent</Text>
                  </TouchableOpacity>
                </View>

                {updateAttendanceMutation.isPending && (
                  <ActivityIndicator size="small" color={primaryColor} style={{ marginTop: 12 }} />
                )}
              </>
            )}

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setEditingMeeting(null)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Create Task Modal */}
      <Modal
        visible={showCreateTaskModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateTaskModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowCreateTaskModal(false)}
        >
          <Pressable style={styles.createTaskModalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Create Task</Text>
            <Text style={styles.createTaskSubtitle}>
              For {member?.firstName} {member?.lastName}
            </Text>

            <Text style={styles.createTaskLabel}>Title *</Text>
            <TextInput
              style={styles.createTaskInput}
              placeholder="Task title..."
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              autoFocus
            />

            <Text style={styles.createTaskLabel}>Description</Text>
            <TextInput
              style={[styles.createTaskInput, { minHeight: 60 }]}
              placeholder="Optional description..."
              value={newTaskDescription}
              onChangeText={setNewTaskDescription}
              multiline
              numberOfLines={2}
            />

            <Text style={styles.createTaskLabel}>Assign To</Text>
            {newTaskAssigneeId ? (
              <View style={styles.selectedAssigneeRow}>
                <Text style={styles.selectedAssigneeName}>
                  {allLeaders?.find((l: any) => l.userId === newTaskAssigneeId)?.name ?? "Selected leader"}
                </Text>
                <TouchableOpacity onPress={() => { setNewTaskAssigneeId(null); setAssigneeSearchText(""); }}>
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.createTaskInput}
                  placeholder="Search leaders..."
                  value={assigneeSearchText}
                  onChangeText={setAssigneeSearchText}
                />
                {assignableLeaders && assignableLeaders.length > 0 && (
                  <View style={styles.leaderSuggestions}>
                    {assignableLeaders.map((leader: any) => (
                      <TouchableOpacity
                        key={leader.userId}
                        style={styles.leaderSuggestionItem}
                        onPress={() => {
                          setNewTaskAssigneeId(leader.userId);
                          setAssigneeSearchText("");
                        }}
                      >
                        <Text style={styles.leaderSuggestionText}>{leader.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={styles.createTaskLabel}>Tags</Text>
            {selectedTags.length > 0 && (
              <View style={styles.selectedTagsRow}>
                {selectedTags.map((tag) => (
                  <View key={tag} style={styles.selectedTagChip}>
                    <Text style={styles.selectedTagChipText}>#{tag}</Text>
                    <TouchableOpacity onPress={() => handleRemoveTag(tag)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name="close-circle" size={16} color="#6366F1" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <TextInput
              style={styles.createTaskInput}
              placeholder="Type to search or add tags..."
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={() => {
                if (tagInput.trim()) handleAddTag(tagInput);
              }}
              returnKeyType="done"
            />
            {filteredTagSuggestions.length > 0 && (
              <View style={styles.tagSuggestions}>
                {filteredTagSuggestions.slice(0, 6).map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.tagSuggestionItem}
                    onPress={() => handleAddTag(tag)}
                  >
                    <Text style={styles.tagSuggestionText}>#{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {tagInput.trim() && !availableTags.includes(tagInput.trim().toLowerCase().replace(/\s+/g, "_")) && (
              <TouchableOpacity
                style={styles.tagCreateNew}
                onPress={() => handleAddTag(tagInput)}
              >
                <Ionicons name="add-circle-outline" size={16} color="#6366F1" />
                <Text style={styles.tagCreateNewText}>
                  Create tag "{tagInput.trim().toLowerCase().replace(/\s+/g, "_")}"
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.createTaskActions}>
              <TouchableOpacity
                style={styles.createTaskCancelBtn}
                onPress={() => {
                  setShowCreateTaskModal(false);
                  setNewTaskTitle("");
                  setNewTaskDescription("");
                  setNewTaskAssigneeId(null);
                  setAssigneeSearchText("");
                  setSelectedTags([]);
                  setTagInput("");
                }}
              >
                <Text style={styles.createTaskCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.createTaskSubmitBtn,
                  { backgroundColor: primaryColor },
                  (!newTaskTitle.trim() || isCreatingTask) && { opacity: 0.5 },
                ]}
                onPress={handleCreateTask}
                disabled={!newTaskTitle.trim() || isCreatingTask}
              >
                {isCreatingTask ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createTaskSubmitText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Full-screen route wrapper — adds UserRoute guard and DragHandle.
 */
export function FollowupDetailScreen() {
  const { group_id, member_id } = useLocalSearchParams<{
    group_id: string;
    member_id: string;
  }>();

  return (
    <UserRoute>
      <DragHandle />
      <FollowupDetailContent groupId={group_id || ""} memberId={member_id || ""} />
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
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
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
    marginBottom: 20,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
  },
  profileSection: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  profileImagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  profileInitials: {
    fontSize: 36,
    fontWeight: "600",
    color: "#fff",
  },
  profileName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  profileJoined: {
    fontSize: 14,
    color: "#666",
  },
  alertSection: {
    backgroundColor: "#FEF2F2",
    padding: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  alertSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#DC2626",
  },
  alertItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  alertItemText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#991B1B",
  },
  section: {
    backgroundColor: "#fff",
    padding: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  quickActions: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  quickAction: {
    alignItems: "center",
    padding: 12,
  },
  quickActionDisabled: {
    opacity: 0.5,
  },
  quickActionText: {
    fontSize: 12,
    color: "#333",
    marginTop: 4,
  },
  quickActionTextDisabled: {
    color: "#999",
  },
  contactText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
    textAlign: "center",
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 12,
    marginTop: 8,
  },
  attendanceIconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attendanceIconItem: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  noAttendanceText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  attendanceLegend: {
    fontSize: 12,
    color: "#999",
    marginTop: 12,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },
  addNoteButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
    alignItems: "center",
  },
  addNoteButtonDisabled: {
    backgroundColor: "#ccc",
  },
  addNoteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  emptyTimeline: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  timeline: {
    marginTop: 8,
  },
  timelineItem: {
    flexDirection: "row",
    marginBottom: 16,
  },
  timelineIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    zIndex: 1,
  },
  timelineLine: {
    position: "absolute",
    left: 15,
    top: 32,
    bottom: -16,
    width: 2,
    backgroundColor: "#e0e0e0",
  },
  timelineContent: {
    flex: 1,
    paddingTop: 4,
  },
  timelineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timelineType: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  timelineNote: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  timelineMeta: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
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
    padding: 20,
    width: "100%",
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  snoozeNoteInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  snoozeOptions: {
    gap: 8,
  },
  snoozeOption: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  snoozeOptionText: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  modalCancelButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCancelText: {
    fontSize: 16,
    color: "#666",
  },
  imageModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageModalContainer: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: "90%",
    height: "80%",
  },
  imageModalClose: {
    position: "absolute",
    top: 60,
    right: 20,
  },
  // Attendance list styles
  attendanceList: {
    gap: 8,
  },
  attendanceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  attendanceRowText: {
    flex: 1,
  },
  attendanceMeetingTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  attendanceMeetingDate: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  // Cross-group attendance styles
  crossGroupSection: {
    marginBottom: 16,
  },
  crossGroupName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
    marginBottom: 8,
  },
  // Serving history styles
  servingList: {
    gap: 8,
  },
  servingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  servingIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e8e8e8",
    justifyContent: "center",
    alignItems: "center",
  },
  servingInfo: {
    flex: 1,
  },
  servingTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  servingPosition: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  // Attendance modal styles
  attendanceModalMeeting: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginTop: 12,
  },
  attendanceModalDate: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  attendanceModalCurrentStatus: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  attendanceModalOptions: {
    flexDirection: "row",
    gap: 12,
  },
  attendanceModalOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  attendanceModalPresent: {
    backgroundColor: "#4CAF50",
  },
  attendanceModalAbsent: {
    backgroundColor: "#FF6B6B",
  },
  attendanceModalOptionActive: {
    opacity: 0.6,
  },
  attendanceModalOptionText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  // Task card styles
  taskCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#4338CA",
  },
  taskCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  taskCardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  taskStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  taskStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  taskStatusText: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  taskCardAssignee: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  taskCardTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  taskCardTagChip: {
    backgroundColor: "#F3F4F6",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  taskCardTagText: {
    fontSize: 11,
    color: "#6366F1",
    fontWeight: "500",
  },
  taskCardGroup: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  addTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  addTaskButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  // Create task modal styles
  createTaskModalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 380,
  },
  createTaskSubtitle: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  createTaskLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
    marginBottom: 4,
    marginTop: 8,
  },
  createTaskInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: "#fafafa",
  },
  selectedAssigneeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    padding: 10,
  },
  selectedAssigneeName: {
    fontSize: 14,
    color: "#4338CA",
    fontWeight: "500",
  },
  leaderSuggestions: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 120,
    overflow: "hidden",
  },
  leaderSuggestionItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  leaderSuggestionText: {
    fontSize: 14,
    color: "#333",
  },
  selectedTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  selectedTagChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEF2FF",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  selectedTagChipText: {
    fontSize: 13,
    color: "#4338CA",
    fontWeight: "500",
  },
  tagSuggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  tagSuggestionItem: {
    backgroundColor: "#F3F4F6",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagSuggestionText: {
    fontSize: 13,
    color: "#4338CA",
  },
  tagCreateNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingVertical: 4,
  },
  tagCreateNewText: {
    fontSize: 13,
    color: "#6366F1",
    fontWeight: "500",
  },
  createTaskActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 20,
  },
  createTaskCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  createTaskCancelText: {
    fontSize: 15,
    color: "#666",
  },
  createTaskSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  createTaskSubmitText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  // Score breakdown styles
  scoresContainer: {
    gap: 12,
  },
  scoreCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 14,
  },
  scoreHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  scoreName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  scoreBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  scoreBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  scoreVariables: {
    gap: 10,
  },
  variableRow: {
    gap: 4,
  },
  variableLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  variableLabel: {
    fontSize: 13,
    color: "#555",
    fontWeight: "500",
  },
  variableRaw: {
    fontSize: 13,
    color: "#888",
  },
  variableBarContainer: {
    height: 6,
    backgroundColor: "#e0e0e0",
    borderRadius: 3,
    overflow: "hidden",
  },
  variableBar: {
    height: "100%",
    borderRadius: 3,
  },
  variableHint: {
    fontSize: 11,
    color: "#aaa",
  },
});
