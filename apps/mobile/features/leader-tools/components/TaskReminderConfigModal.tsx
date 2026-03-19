import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedQuery, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import { generateId } from "../utils/generateId";
import { useTheme } from "@hooks/useTheme";

type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type Role = {
  id: string;
  name: string;
  assignedMemberId: string | null;
};

type Task = {
  id: string;
  message: string;
  roleIds: string[];
};

type Schedule = Record<DayOfWeek, Task[]>;

type TaskReminderConfig = {
  roles: Role[];
  schedule: Schedule;
  deliveryMode: "task_only" | "task_and_channel_post";
  targetChannelSlugs: string[];
};

type TaskReminderConfigModalProps = {
  visible: boolean;
  onClose: () => void;
  groupId: string;
};

const DAYS: { key: DayOfWeek; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

const DELIVERY_MODE_OPTIONS = [
  { value: "task_only", label: "Create/assign tasks only" },
  { value: "task_and_channel_post", label: "Create tasks + post task cards to channels" },
] as const;

const DEFAULT_CONFIG: TaskReminderConfig = {
  roles: [],
  schedule: {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  },
  deliveryMode: "task_and_channel_post",
  targetChannelSlugs: [],
};

export function TaskReminderConfigModal({
  visible,
  onClose,
  groupId,
}: TaskReminderConfigModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();
  const { token } = useAuth();

  // State
  const [config, setConfig] = useState<TaskReminderConfig>(DEFAULT_CONFIG);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>("monday");
  const [isDirty, setIsDirty] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingTaskDay, setEditingTaskDay] = useState<DayOfWeek | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Use groupId directly as Convex ID
  const convexGroupId = groupId as Id<"groups"> | undefined;

  // Fetch current config using Convex ID
  const configData = useQuery(
    api.functions.groupBots.getConfig,
    visible && convexGroupId ? { groupId: convexGroupId, botId: "task-reminder" } : "skip"
  );
  const isLoading = configData === undefined && visible && !!groupId;
  const error = configData === null;

  // Fetch group leaders for role assignment
  // SECURITY: token is required to access leader list (only members/admins can see)
  const leadersData = useQuery(
    api.functions.groups.index.getLeaders,
    visible && convexGroupId ? { groupId: convexGroupId, token: token ?? undefined } : "skip"
  );

  // Fetch group members for role assignment
  // SECURITY: token is required to access member list (only members/admins can see)
  const membersData = useQuery(
    api.functions.groupMembers.list,
    visible && convexGroupId ? { groupId: convexGroupId, limit: 200, token: token ?? undefined } : "skip"
  );

  // Fetch channels for channel selection
  const channelsData = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    visible && convexGroupId ? { groupId: convexGroupId, includeArchived: true } : "skip"
  );

  // Update config mutation (auto-injects token)
  const updateConfigMutation = useAuthenticatedMutation(api.functions.groupBots.updateConfig);

  const handleUpdateConfig = async () => {
    if (!convexGroupId) return;
    setIsSaving(true);
    try {
      await updateConfigMutation({
        groupId: convexGroupId,
        botId: "task-reminder",
        config: config,
      });
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  // Type for transformed member data used throughout this component
  type TransformedMember = {
    id: string;
    user: { firstName: string; lastName: string };
  };

  // For compatibility with the rest of the component, transform Convex data
  // to match the expected structure { id, user: { firstName, lastName } }
  const groupData = React.useMemo((): { leaders: TransformedMember[]; members: TransformedMember[] } | null => {
    if (!leadersData || !membersData) return null;

    // Transform leaders data - filter out nulls and map to TransformedMember
    const transformedLeaders: TransformedMember[] = (leadersData || [])
      .filter((user): user is NonNullable<typeof user> => user !== null)
      .map((user) => ({
        id: user._id,
        user: { firstName: user.firstName || "", lastName: user.lastName || "" },
      }));

    // Transform members data from groupMembers.list which returns { items, ... }
    const transformedMembers: TransformedMember[] = (membersData.items || [])
      .filter((item) => item.user != null) // Use loose equality to filter both null and undefined
      .map((item) => {
        const user = item.user!;
        return {
          id: user.id,
          user: { firstName: user.firstName || "", lastName: user.lastName || "" },
        };
      });

    return {
      leaders: transformedLeaders,
      members: transformedMembers,
    };
  }, [leadersData, membersData]);

  // Load config when data is fetched
  useEffect(() => {
    if (configData?.config) {
      const loadedConfig = configData.config as TaskReminderConfig & {
        targetChannelSlug?: string;
        delivery?: "chat" | "notification" | "both";
      };
      const deliveryMode =
        loadedConfig.deliveryMode ??
        (loadedConfig.delivery === "notification"
          ? "task_only"
          : "task_and_channel_post");
      const targetChannelSlugs = loadedConfig.targetChannelSlugs?.length
        ? loadedConfig.targetChannelSlugs
        : loadedConfig.targetChannelSlug
          ? [loadedConfig.targetChannelSlug]
          : [];
      setConfig({
        roles: loadedConfig.roles || [],
        schedule: loadedConfig.schedule || DEFAULT_CONFIG.schedule,
        deliveryMode,
        targetChannelSlugs,
      });
      setIsDirty(false);
    }
  }, [configData]);

  // Reset editing state when modal visibility changes
  useEffect(() => {
    if (visible) {
      // Reset editing state when modal opens
      setEditingTask(null);
      setEditingTaskDay(null);
    }
  }, [visible]);

  // Get all members for dropdown (combine leaders and members, sort leaders first then alphabetically)
  // Filter out members who are also leaders to avoid duplicates
  const allMembers = React.useMemo(() => {
    const leaders: TransformedMember[] = groupData?.leaders || [];
    const members: TransformedMember[] = groupData?.members || [];

    // Get leader IDs for deduplication
    const leaderIds = new Set(leaders.map((l: TransformedMember) => l.id));

    // Sort leaders alphabetically
    const sortedLeaders = [...leaders].sort((a: TransformedMember, b: TransformedMember) => {
      const nameA = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
      const nameB = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    // Filter out members who are also leaders, then sort alphabetically
    const sortedMembers = members
      .filter((m: TransformedMember) => !leaderIds.has(m.id))
      .sort((a: TransformedMember, b: TransformedMember) => {
        const nameA = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
        const nameB = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

    // Leaders first, then members (no duplicates)
    return [...sortedLeaders, ...sortedMembers];
  }, [groupData?.leaders, groupData?.members]);

  // Role management
  const addRole = () => {
    const newRole: Role = {
      id: generateId(),
      name: "",
      assignedMemberId: null,
    };
    setConfig((prev) => ({
      ...prev,
      roles: [...prev.roles, newRole],
    }));
    setIsDirty(true);
  };

  const updateRole = (roleId: string, updates: Partial<Role>) => {
    setConfig((prev) => ({
      ...prev,
      roles: prev.roles.map((r) => (r.id === roleId ? { ...r, ...updates } : r)),
    }));
    setIsDirty(true);
  };

  const deleteRole = (roleId: string) => {
    // Check if role is used in any tasks
    const isUsed = Object.values(config.schedule).some((tasks) =>
      tasks.some((task) => task.roleIds.includes(roleId))
    );

    if (isUsed) {
      Alert.alert(
        "Role in Use",
        "This role is assigned to one or more tasks. The tasks will show a warning until you reassign them.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete Anyway",
            style: "destructive",
            onPress: () => {
              setConfig((prev) => ({
                ...prev,
                roles: prev.roles.filter((r) => r.id !== roleId),
              }));
              setIsDirty(true);
            },
          },
        ]
      );
    } else {
      setConfig((prev) => ({
        ...prev,
        roles: prev.roles.filter((r) => r.id !== roleId),
      }));
      setIsDirty(true);
    }
  };

  // Task management
  const addTask = () => {
    const newTask: Task = {
      id: generateId(),
      message: "",
      roleIds: [],
    };
    setEditingTask(newTask);
    setEditingTaskDay(selectedDay);
  };

  const saveTask = (task: Task) => {
    if (!editingTaskDay) return;

    setConfig((prev) => {
      const dayTasks = prev.schedule[editingTaskDay];
      const existingIndex = dayTasks.findIndex((t) => t.id === task.id);

      if (existingIndex >= 0) {
        // Update existing task
        const newTasks = [...dayTasks];
        newTasks[existingIndex] = task;
        return {
          ...prev,
          schedule: { ...prev.schedule, [editingTaskDay]: newTasks },
        };
      } else {
        // Add new task
        return {
          ...prev,
          schedule: { ...prev.schedule, [editingTaskDay]: [...dayTasks, task] },
        };
      }
    });

    setEditingTask(null);
    setEditingTaskDay(null);
    setIsDirty(true);
  };

  const deleteTask = (day: DayOfWeek, taskId: string) => {
    Alert.alert("Delete Task", "Are you sure you want to delete this task?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setConfig((prev) => ({
            ...prev,
            schedule: {
              ...prev.schedule,
              [day]: prev.schedule[day].filter((t) => t.id !== taskId),
            },
          }));
          setIsDirty(true);
        },
      },
    ]);
  };

  const handleSave = () => {
    handleUpdateConfig();
  };

  // Check if a task has invalid roles (role was deleted)
  const hasInvalidRoles = (task: Task) => {
    return task.roleIds.some((roleId) => !config.roles.find((r) => r.id === roleId));
  };

  // Get role names for display
  const getRoleNames = (roleIds: string[]) => {
    return roleIds
      .map((id) => config.roles.find((r) => r.id === id)?.name || "Unknown")
      .join(", ");
  };

  // Render role item
  const renderRoleItem = (role: Role) => {
    const assignedMember = allMembers.find(
      (m) => m.id === role.assignedMemberId
    );

    return (
      <View key={role.id} style={[styles.roleItem, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          style={[styles.roleNameInput, { color: colors.text, backgroundColor: colors.surfaceSecondary }]}
          value={role.name}
          onChangeText={(text) => updateRole(role.id, { name: text })}
          placeholder="Role name"
          placeholderTextColor={colors.textTertiary}
        />
        <TouchableOpacity
          style={[styles.memberSelector, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => {
            const leaders: TransformedMember[] = groupData?.leaders || [];
            const members: TransformedMember[] = groupData?.members || [];

            // Get leader IDs for deduplication
            const leaderIds = new Set(leaders.map((l: TransformedMember) => l.id));

            // Sort leaders alphabetically
            const sortedLeaders = [...leaders].sort((a: TransformedMember, b: TransformedMember) => {
              const nameA = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
              const nameB = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
              return nameA.localeCompare(nameB);
            });

            // Filter out members who are also leaders, then sort alphabetically
            const sortedMembers = members
              .filter((m: TransformedMember) => !leaderIds.has(m.id))
              .sort((a: TransformedMember, b: TransformedMember) => {
                const nameA = `${a.user.firstName} ${a.user.lastName}`.toLowerCase();
                const nameB = `${b.user.firstName} ${b.user.lastName}`.toLowerCase();
                return nameA.localeCompare(nameB);
              });

            // Build alert options with section headers
            // Note: Section headers use no-op onPress to prevent dismissing the alert when tapped
            const options: { text: string; onPress?: () => void; style?: "cancel" | "default" | "destructive" }[] = [
              { text: "None", onPress: () => updateRole(role.id, { assignedMemberId: null }) },
            ];

            // Add leaders section
            if (sortedLeaders.length > 0) {
              options.push({ text: "— LEADERS —", onPress: () => {}, style: "default" });
              sortedLeaders.forEach((member) => {
                options.push({
                  text: `${member.user.firstName} ${member.user.lastName}`,
                  onPress: () => updateRole(role.id, { assignedMemberId: member.id }),
                });
              });
            }

            // Add members section (excludes people who are already in leaders)
            if (sortedMembers.length > 0) {
              options.push({ text: "— MEMBERS —", onPress: () => {}, style: "default" });
              sortedMembers.forEach((member) => {
                options.push({
                  text: `${member.user.firstName} ${member.user.lastName}`,
                  onPress: () => updateRole(role.id, { assignedMemberId: member.id }),
                });
              });
            }

            options.push({ text: "Cancel", style: "cancel" });

            Alert.alert(
              "Assign Member",
              "Select a member for this role",
              options
            );
          }}
        >
          <Text style={[styles.memberSelectorText, { color: colors.text }]} numberOfLines={1}>
            {assignedMember
              ? `${assignedMember.user.firstName} ${assignedMember.user.lastName}`
              : "Select member"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => deleteRole(role.id)}
        >
          <Ionicons name="trash-outline" size={18} color={colors.destructive} />
        </TouchableOpacity>
      </View>
    );
  };

  // Render task item
  const renderTaskItem = (task: Task, day: DayOfWeek) => {
    const hasInvalid = hasInvalidRoles(task);

    return (
      <View
        key={task.id}
        style={[styles.taskItem, { backgroundColor: colors.surfaceSecondary }, hasInvalid && styles.taskItemWarning]}
      >
        <View style={styles.taskContent}>
          <Text style={[styles.taskMessage, { color: colors.text }]} numberOfLines={2}>
            {task.message || "No message"}
          </Text>
          <Text style={[styles.taskMeta, { color: colors.textSecondary }]}>
            Roles: {getRoleNames(task.roleIds) || "None"}
          </Text>
          {hasInvalid && (
            <Text style={[styles.taskWarning, { color: colors.destructive }]}>
              Some roles no longer exist
            </Text>
          )}
        </View>
        <View style={styles.taskActions}>
          <TouchableOpacity
            style={styles.taskActionButton}
            onPress={() => {
              setEditingTask(task);
              setEditingTaskDay(day);
            }}
          >
            <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.taskActionButton}
            onPress={() => deleteTask(day, task.id)}
          >
            <Ionicons name="trash-outline" size={18} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Render task editor modal
  const renderTaskEditor = () => {
    if (!editingTask) return null;

    return (
      <Modal
        visible={!!editingTask}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingTask(null)}
      >
        <KeyboardAvoidingView
          style={styles.taskEditorOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        >
          <Pressable
            testID="task-editor-backdrop"
            style={[styles.taskEditorOverlayBackdrop, { backgroundColor: colors.overlay }]}
            onPress={Keyboard.dismiss}
          >
            <Pressable
              style={[styles.taskEditorContainer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.modalBackground }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={[styles.taskEditorHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.taskEditorTitle, { color: colors.text }]}>
                  {config.schedule[editingTaskDay!]?.find((t) => t.id === editingTask.id)
                    ? "Edit Task"
                    : "New Task"}
                </Text>
                <TouchableOpacity onPress={() => setEditingTask(null)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView
                testID="task-editor-scroll"
                style={styles.taskEditorContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              >
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Message</Text>
                <TextInput
                  style={[styles.input, styles.textareaInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.text }]}
                  value={editingTask.message}
                  onChangeText={(text) =>
                    setEditingTask((prev) => prev && { ...prev, message: text })
                  }
                  placeholder="Enter reminder message"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  numberOfLines={3}
                />

                <Text style={[styles.fieldLabel, { color: colors.text }]}>Assign to Roles</Text>
                <View style={styles.roleCheckboxes}>
                  {config.roles.length === 0 ? (
                    <Text style={[styles.noRolesText, { color: colors.textTertiary }]}>
                      No roles defined. Add roles above first.
                    </Text>
                  ) : (
                    config.roles.map((role) => (
                      <TouchableOpacity
                        key={role.id}
                        style={[
                          styles.roleCheckbox,
                          { backgroundColor: colors.surfaceSecondary },
                          editingTask.roleIds.includes(role.id) &&
                            [styles.roleCheckboxSelected, { backgroundColor: colors.selectedBackground }],
                        ]}
                        onPress={() => {
                          setEditingTask((prev) => {
                            if (!prev) return prev;
                            const isSelected = prev.roleIds.includes(role.id);
                            return {
                              ...prev,
                              roleIds: isSelected
                                ? prev.roleIds.filter((id) => id !== role.id)
                                : [...prev.roleIds, role.id],
                            };
                          });
                        }}
                      >
                        <Ionicons
                          name={
                            editingTask.roleIds.includes(role.id)
                              ? "checkbox"
                              : "square-outline"
                          }
                          size={20}
                          color={
                            editingTask.roleIds.includes(role.id)
                              ? primaryColor
                              : colors.textSecondary
                          }
                        />
                        <Text style={[styles.roleCheckboxText, { color: colors.text }]}>
                          {role.name || "Unnamed role"}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>

              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.saveTaskButton,
                  { backgroundColor: primaryColor },
                  (!editingTask.message || editingTask.roleIds.length === 0) &&
                    [styles.saveTaskButtonDisabled, { backgroundColor: colors.border }],
                ]}
                onPress={() => saveTask(editingTask)}
                disabled={!editingTask.message || editingTask.roleIds.length === 0}
              >
                <Text style={styles.saveTaskButtonText}>Save Task</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerIcon}>📋</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Task Reminder Settings</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading configuration...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Failed to load configuration</Text>
          </View>
        ) : (
          <>
            <ScrollView
              testID="task-reminder-config-scroll"
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            >
              {/* Roles Section */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>ROLES</Text>
                  <TouchableOpacity style={styles.addButton} onPress={addRole}>
                    <Ionicons name="add" size={20} color={primaryColor} />
                    <Text style={[styles.addButtonText, { color: primaryColor }]}>
                      Add
                    </Text>
                  </TouchableOpacity>
                </View>
                {config.roles.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                    No roles defined. Add roles to assign members to tasks.
                  </Text>
                ) : (
                  config.roles.map(renderRoleItem)
                )}
              </View>

              {/* Delivery Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>DELIVERY</Text>
                <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                  Choose whether the bot only creates tasks or also posts task cards to channels.
                </Text>

                <View style={styles.deliveryOptions}>
                  {DELIVERY_MODE_OPTIONS.map((option) => {
                    const isSelected = config.deliveryMode === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.deliveryOption,
                          { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                          isSelected && [styles.deliveryOptionSelected, { backgroundColor: primaryColor, borderColor: primaryColor }],
                        ]}
                        onPress={() => {
                          setConfig((prev) => ({
                            ...prev,
                            deliveryMode: option.value,
                          }));
                          setIsDirty(true);
                        }}
                      >
                        <Text
                          style={[
                            styles.deliveryOptionText,
                            { color: colors.text },
                            isSelected && styles.deliveryOptionTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {config.deliveryMode === "task_and_channel_post" ? (
                  <>
                    <Text style={[styles.sectionTitle, { marginTop: 16, color: colors.textSecondary }]}>
                      CHANNEL TARGETS
                    </Text>
                    <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                      Select one or more channels to receive task cards.
                    </Text>

                    <View style={styles.channelSelectContainer}>
                      {(channelsData ?? [])
                        .filter((ch: { isArchived: boolean }) => !ch.isArchived)
                        .map((channel: { slug: string; name: string; channelType: string }) => {
                          const displayName =
                            channel.channelType === "main"
                              ? "General"
                              : channel.channelType === "leaders"
                                ? "Leaders"
                                : channel.name;
                          const isSelected = config.targetChannelSlugs.includes(channel.slug);
                          return (
                            <TouchableOpacity
                              key={channel.slug}
                              style={[
                                styles.channelOption,
                                { backgroundColor: colors.surface, borderColor: colors.border },
                                isSelected && [styles.channelOptionSelected, { backgroundColor: primaryColor, borderColor: primaryColor }],
                              ]}
                              onPress={() => {
                                setConfig((prev) => ({
                                  ...prev,
                                  targetChannelSlugs: isSelected
                                    ? prev.targetChannelSlugs.filter((slug) => slug !== channel.slug)
                                    : [...prev.targetChannelSlugs, channel.slug],
                                }));
                                setIsDirty(true);
                              }}
                            >
                              <Text
                                style={[
                                  styles.channelOptionText,
                                  { color: colors.text },
                                  isSelected && styles.channelOptionTextSelected,
                                ]}
                              >
                                {displayName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  </>
                ) : null}
              </View>

              {/* Weekly Schedule Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>WEEKLY SCHEDULE</Text>

                {/* Day tabs */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.dayTabs}
                  contentContainerStyle={styles.dayTabsContent}
                >
                  {DAYS.map((day) => {
                    const taskCount = config.schedule[day.key].length;
                    return (
                      <TouchableOpacity
                        key={day.key}
                        style={[
                          styles.dayTab,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                          selectedDay === day.key && [styles.dayTabSelected, { backgroundColor: primaryColor, borderColor: primaryColor }],
                        ]}
                        onPress={() => setSelectedDay(day.key)}
                      >
                        <Text
                          style={[
                            styles.dayTabText,
                            { color: colors.textSecondary },
                            selectedDay === day.key && styles.dayTabTextSelected,
                          ]}
                        >
                          {day.short}
                        </Text>
                        {taskCount > 0 && (
                          <View style={[styles.taskBadge, { backgroundColor: colors.border }]}>
                            <Text style={[styles.taskBadgeText, { color: colors.textSecondary }]}>{taskCount}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Tasks for selected day */}
                <View style={[styles.tasksContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.tasksHeader}>
                    <Text style={[styles.tasksTitle, { color: colors.text }]}>
                      {DAYS.find((d) => d.key === selectedDay)?.label} Tasks
                    </Text>
                    <TouchableOpacity style={styles.addButton} onPress={addTask}>
                      <Ionicons name="add" size={20} color={primaryColor} />
                      <Text style={[styles.addButtonText, { color: primaryColor }]}>
                        Add
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {config.schedule[selectedDay].length === 0 ? (
                    <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                      No tasks for {DAYS.find((d) => d.key === selectedDay)?.label}.
                      Add a task to send reminders.
                    </Text>
                  ) : (
                    config.schedule[selectedDay].map((task) =>
                      renderTaskItem(task, selectedDay)
                    )
                  )}
                </View>
              </View>
            </ScrollView>

            {/* Save button */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.surface, borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  { backgroundColor: primaryColor },
                  (!isDirty || isSaving) && [styles.saveButtonDisabled, { backgroundColor: colors.border }],
                ]}
                onPress={handleSave}
                disabled={!isDirty || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Task editor modal */}
        {renderTaskEditor()}
      </KeyboardAvoidingView>
    </Modal>
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
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 4,
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
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
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sectionDescription: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef3cd",
    borderWidth: 1,
    borderColor: "#ffc107",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: "#856404",
    lineHeight: 18,
  },
  channelSelectContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  channelOption: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  channelOptionSelected: {
  },
  channelOptionText: {
    fontSize: 14,
  },
  channelOptionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  emptyText: {
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    padding: 16,
  },
  roleItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  roleNameInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  memberSelector: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 120,
  },
  memberSelectorText: {
    fontSize: 14,
    flex: 1,
    marginRight: 4,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 4,
  },
  dayTabs: {
    marginBottom: 12,
  },
  dayTabsContent: {
    paddingVertical: 4,
  },
  dayTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 8,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  dayTabSelected: {
  },
  dayTabText: {
    fontSize: 14,
    fontWeight: "500",
  },
  dayTabTextSelected: {
    color: "#fff",
  },
  taskBadge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  taskBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  tasksContainer: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  tasksHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  tasksTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  taskItem: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  taskItemWarning: {
    borderWidth: 1,
    borderColor: "#f39c12",
    backgroundColor: "#fef9e7",
  },
  taskContent: {
    flex: 1,
  },
  taskMessage: {
    fontSize: 14,
    marginBottom: 4,
  },
  taskMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  taskWarning: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: "500",
  },
  taskActions: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  taskActionButton: {
    padding: 8,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  saveButton: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonDisabled: {
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  // Task editor styles
  taskEditorOverlay: {
    flex: 1,
  },
  taskEditorOverlayBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  taskEditorContainer: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "80%",
  },
  taskEditorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  taskEditorTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  taskEditorContent: {
    padding: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textareaInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  roleCheckboxes: {
    marginTop: 4,
  },
  roleCheckbox: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  roleCheckboxSelected: {
  },
  roleCheckboxText: {
    fontSize: 14,
    marginLeft: 10,
  },
  noRolesText: {
    fontSize: 14,
    fontStyle: "italic",
    padding: 12,
  },
  deliveryOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  deliveryOption: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  deliveryOptionSelected: {
  },
  deliveryOptionText: {
    fontSize: 14,
  },
  deliveryOptionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  saveTaskButton: {
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    alignItems: "center",
  },
  saveTaskButtonDisabled: {
  },
  saveTaskButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
