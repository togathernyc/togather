/**
 * SlackBotConfigScreen - Admin page for Slack service planning bot configuration
 *
 * Allows community admins to manage: enable/disable, team members (with Slack member picker),
 * thread mentions, nag schedule, AI prompts, PCO config, and service plan items.
 */
import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import {
  useSlackBotConfig,
  type SlackBotTeamMember,
  type SlackBotNagEntry,
  type SlackMember,
  type SlackChannel,
  type PcoRoleMapping,
  type ServicePlanItemV2,
  sanitizeV2Item,
} from "../hooks/useSlackBotConfig";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AVAILABLE_ROLES = ["preacher", "ml", "worship", "creative", "production", "admin", "av"];
const AVAILABLE_LOCATIONS = ["Manhattan", "Brooklyn"];

export function SlackBotConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const {
    config,
    status,
    isLoading,
    communityId,
    toggleBot,
    toggleDevMode,
    updateTeamMembers,
    updateThreadMentions,
    updateNagSchedule,
    updatePrompts,
    updatePcoConfig,
    updateServicePlanItems,
    updateThreadCreation,
    updateSlackChannelId,
    slackMembers,
    isLoadingMembers,
    fetchSlackMembers,
    slackChannels,
    isLoadingChannels,
    fetchSlackChannels,
    pcoTeams,
    pcoPlanItemTitles,
    isLoadingPcoData,
    fetchPcoTeamsAndItems,
    sendNag,
  } = useSlackBotConfig();

  const [isToggling, setIsToggling] = useState(false);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [editingMember, setEditingMember] = useState<SlackBotTeamMember | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);
  const [editingLocations, setEditingLocations] = useState<string[]>([]);
  const [showRoleEditor, setShowRoleEditor] = useState(false);

  // Thread mentions editing
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionLocation, setMentionLocation] = useState<string>("");

  // Eagerly load channel names so the current channel ID can be resolved
  useEffect(() => {
    if (config && slackChannels.length === 0) {
      fetchSlackChannels();
    }
  }, [config, slackChannels.length, fetchSlackChannels]);

  // Channel picker
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");

  // AI Config editing
  const [showAiEditor, setShowAiEditor] = useState(false);
  const [editAiModel, setEditAiModel] = useState("");
  const [editAiPersonality, setEditAiPersonality] = useState("");
  const [editAiRules, setEditAiRules] = useState("");
  const [editAiTeamContext, setEditAiTeamContext] = useState("");
  const [editNagTones, setEditNagTones] = useState<Record<string, string>>({});

  // Nag Schedule editing
  const [showNagEditor, setShowNagEditor] = useState(false);
  const [editingNagIndex, setEditingNagIndex] = useState<number | null>(null);
  const [editNagLabel, setEditNagLabel] = useState("");
  const [editNagDay, setEditNagDay] = useState(0);
  const [editNagHour, setEditNagHour] = useState(10);
  const [editNagUrgency, setEditNagUrgency] = useState("gentle");

  // PCO Config editing
  const [showPcoEditor, setShowPcoEditor] = useState(false);
  const [editPcoCommunityId, setEditPcoCommunityId] = useState("");
  const [editPcoServiceTypeIds, setEditPcoServiceTypeIds] = useState<Record<string, string>>({});
  const [editPcoRoleMappings, setEditPcoRoleMappings] = useState<Record<string, { teamNamePattern: string; positionName: string }>>({});

  // Service Plan Item editing
  const [showItemEditor, setShowItemEditor] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editItemId, setEditItemId] = useState("");
  const [editItemLabel, setEditItemLabel] = useState("");
  const [editItemRoles, setEditItemRoles] = useState<string[]>([]);
  const [editItemActionType, setEditItemActionType] = useState<string>("none");
  const [editItemTeamPattern, setEditItemTeamPattern] = useState("");
  const [editItemPositionName, setEditItemPositionName] = useState("");
  const [editItemTitlePattern, setEditItemTitlePattern] = useState("");
  const [editItemField, setEditItemField] = useState("description");
  const [editItemPreserveSections, setEditItemPreserveSections] = useState("");
  const [editItemAiInstructions, setEditItemAiInstructions] = useState("");

  // Send Nag
  const [nagLocation, setNagLocation] = useState<string>("Manhattan");
  const [nagUrgency, setNagUrgency] = useState<string>("direct");
  const [isSendingNag, setIsSendingNag] = useState(false);
  const [nagResult, setNagResult] = useState<string | null>(null);

  const handleSendNag = useCallback(async () => {
    if (!communityId) return;
    setIsSendingNag(true);
    setNagResult(null);
    try {
      await sendNag({ communityId, location: nagLocation, urgency: nagUrgency });
      setNagResult("Nag sent successfully!");
    } catch (error) {
      setNagResult(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsSendingNag(false);
    }
  }, [communityId, sendNag, nagLocation, nagUrgency]);

  const handleToggleBot = useCallback(async () => {
    if (!config || !communityId) return;
    setIsToggling(true);
    try {
      await toggleBot({ communityId, enabled: !config.enabled });
    } catch (error) {
      Alert.alert("Error", "Failed to toggle bot");
    } finally {
      setIsToggling(false);
    }
  }, [config, communityId, toggleBot]);

  const handleToggleDevMode = useCallback(async () => {
    if (!config || !communityId) return;
    try {
      await toggleDevMode({ communityId, devMode: !config.devMode });
    } catch (error) {
      Alert.alert("Error", "Failed to toggle dev mode");
    }
  }, [config, communityId, toggleDevMode]);

  // ---- Thread Creation Schedule ----

  const handleUpdateThreadDay = useCallback(async (dayOfWeek: number) => {
    if (!config || !communityId) return;
    try {
      await updateThreadCreation({
        communityId,
        threadCreation: { dayOfWeek, hourET: config.threadCreation.hourET },
      });
    } catch (error) {
      Alert.alert("Error", "Failed to update thread creation day");
    }
  }, [config, communityId, updateThreadCreation]);

  const handleUpdateThreadHour = useCallback(async (hourET: number) => {
    if (!config || !communityId) return;
    try {
      await updateThreadCreation({
        communityId,
        threadCreation: { dayOfWeek: config.threadCreation.dayOfWeek, hourET },
      });
    } catch (error) {
      Alert.alert("Error", "Failed to update thread creation hour");
    }
  }, [config, communityId, updateThreadCreation]);

  // ---- Channel Selection ----

  const handleOpenChannelPicker = useCallback(() => {
    fetchSlackChannels();
    setChannelSearch("");
    setShowChannelPicker(true);
  }, [fetchSlackChannels]);

  const handleSelectChannel = useCallback(async (channel: SlackChannel) => {
    if (!communityId) return;
    setShowChannelPicker(false);
    try {
      await updateSlackChannelId({ communityId, slackChannelId: channel.id });
    } catch (error) {
      Alert.alert("Error", "Failed to update Slack channel");
    }
  }, [communityId, updateSlackChannelId]);

  const filteredChannels = useMemo(() => {
    if (!channelSearch.trim()) return slackChannels;
    const q = channelSearch.toLowerCase();
    return slackChannels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [slackChannels, channelSearch]);

  const resolveChannelName = useCallback(
    (channelId: string): string => {
      const channel = slackChannels.find((ch) => ch.id === channelId);
      return channel ? `#${channel.name}` : channelId;
    },
    [slackChannels]
  );

  // ---- Team Member Management ----

  const handleOpenMemberPicker = useCallback(() => {
    fetchSlackMembers();
    setMemberSearch("");
    setShowMemberPicker(true);
  }, [fetchSlackMembers]);

  const handleSelectSlackMember = useCallback(
    (slackMember: SlackMember) => {
      setShowMemberPicker(false);
      // Pre-populate the role editor with this member's info
      setEditingMember({
        name: slackMember.realName,
        slackUserId: slackMember.id,
        roles: [],
        locations: [...AVAILABLE_LOCATIONS],
      });
      setEditingRoles([]);
      setEditingLocations([...AVAILABLE_LOCATIONS]);
      setShowRoleEditor(true);
    },
    []
  );

  const handleEditExistingMember = useCallback((member: SlackBotTeamMember) => {
    setEditingMember(member);
    setEditingRoles([...member.roles]);
    setEditingLocations([...member.locations]);
    setShowRoleEditor(true);
  }, []);

  const handleSaveMember = useCallback(async () => {
    if (!editingMember || !config || !communityId) return;
    if (editingRoles.length === 0) {
      Alert.alert("Error", "Select at least one role");
      return;
    }
    if (editingLocations.length === 0) {
      Alert.alert("Error", "Select at least one location");
      return;
    }

    const updatedMember: SlackBotTeamMember = {
      ...editingMember,
      roles: editingRoles,
      locations: editingLocations,
    };

    // Replace existing or add new
    const existingIndex = config.teamMembers.findIndex(
      (m: SlackBotTeamMember) => m.slackUserId === updatedMember.slackUserId
    );
    const newMembers = [...config.teamMembers];
    if (existingIndex >= 0) {
      newMembers[existingIndex] = updatedMember;
    } else {
      newMembers.push(updatedMember);
    }

    try {
      await updateTeamMembers({ communityId, teamMembers: newMembers });
      setShowRoleEditor(false);
      setEditingMember(null);
    } catch (error) {
      Alert.alert("Error", "Failed to save team member");
    }
  }, [editingMember, editingRoles, editingLocations, config, communityId, updateTeamMembers]);

  const handleRemoveMember = useCallback(
    async (slackUserId: string) => {
      if (!config || !communityId) return;
      const doRemove = async () => {
        const newMembers = config.teamMembers.filter(
          (m: SlackBotTeamMember) => m.slackUserId !== slackUserId
        );
        try {
          await updateTeamMembers({ communityId, teamMembers: newMembers });
        } catch (error) {
          if (Platform.OS === "web") {
            window.alert("Failed to remove member");
          } else {
            Alert.alert("Error", "Failed to remove member");
          }
        }
      };

      if (Platform.OS === "web") {
        if (window.confirm("Remove this member?")) await doRemove();
      } else {
        Alert.alert("Remove Member", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doRemove },
        ]);
      }
    },
    [config, communityId, updateTeamMembers]
  );

  // ---- Thread Mentions Management ----

  const handleOpenMentionPicker = useCallback(
    (location: string) => {
      fetchSlackMembers();
      setMentionLocation(location);
      setMemberSearch("");
      setShowMentionPicker(true);
    },
    [fetchSlackMembers]
  );

  const handleToggleMention = useCallback(
    async (slackUserId: string) => {
      if (!config || !communityId || !mentionLocation) return;
      const currentMentions = { ...config.threadMentions };
      const locationMentions = currentMentions[mentionLocation] ?? [];

      if (locationMentions.includes(slackUserId)) {
        currentMentions[mentionLocation] = locationMentions.filter(
          (id: string) => id !== slackUserId
        );
      } else {
        currentMentions[mentionLocation] = [...locationMentions, slackUserId];
      }

      try {
        await updateThreadMentions({ communityId, threadMentions: currentMentions });
      } catch (error) {
        Alert.alert("Error", "Failed to update mentions");
      }
    },
    [config, communityId, mentionLocation, updateThreadMentions]
  );

  // ---- AI Config Editing ----

  const handleOpenAiEditor = useCallback(() => {
    if (!config) return;
    setEditAiModel(config.aiConfig.model);
    setEditAiPersonality(config.aiConfig.botPersonality);
    setEditAiRules(config.aiConfig.responseRules);
    setEditAiTeamContext(config.aiConfig.teamContext);
    setEditNagTones({ ...config.aiConfig.nagToneByLevel });
    setShowAiEditor(true);
  }, [config]);

  const handleSaveAiConfig = useCallback(async () => {
    if (!config || !communityId) return;
    try {
      await updatePrompts({
        communityId,
        aiConfig: {
          model: editAiModel,
          botPersonality: editAiPersonality,
          responseRules: editAiRules,
          teamContext: editAiTeamContext,
          nagToneByLevel: editNagTones,
        },
      });
      setShowAiEditor(false);
    } catch (error) {
      Alert.alert("Error", "Failed to save AI configuration");
    }
  }, [config, communityId, updatePrompts, editAiModel, editAiPersonality, editAiRules, editAiTeamContext, editNagTones]);

  // ---- Nag Schedule Editing ----

  const handleOpenNagEditor = useCallback(
    (index: number | null) => {
      if (!config) return;
      if (index !== null) {
        const nag = config.nagSchedule[index];
        setEditNagLabel(nag.label);
        setEditNagDay(nag.dayOfWeek);
        setEditNagHour(nag.hourET);
        setEditNagUrgency(nag.urgency);
      } else {
        setEditNagLabel("");
        setEditNagDay(3);
        setEditNagHour(10);
        setEditNagUrgency("gentle");
      }
      setEditingNagIndex(index);
      setShowNagEditor(true);
    },
    [config]
  );

  const handleSaveNagEntry = useCallback(async () => {
    if (!config || !communityId) return;
    if (!editNagLabel.trim()) {
      Alert.alert("Error", "Label is required");
      return;
    }

    const entry: SlackBotNagEntry = {
      dayOfWeek: editNagDay,
      hourET: editNagHour,
      urgency: editNagUrgency,
      label: editNagLabel.trim(),
    };

    const newSchedule = [...config.nagSchedule];
    if (editingNagIndex !== null) {
      newSchedule[editingNagIndex] = entry;
    } else {
      newSchedule.push(entry);
    }

    try {
      await updateNagSchedule({ communityId, nagSchedule: newSchedule });
      setShowNagEditor(false);
    } catch (error) {
      Alert.alert("Error", "Failed to save nag schedule");
    }
  }, [config, communityId, updateNagSchedule, editingNagIndex, editNagLabel, editNagDay, editNagHour, editNagUrgency]);

  const handleRemoveNagEntry = useCallback(
    async (index: number) => {
      if (!config || !communityId) return;
      const label = config.nagSchedule[index]?.label ?? "this entry";
      const doRemove = async () => {
        const newSchedule = config.nagSchedule.filter((_: SlackBotNagEntry, i: number) => i !== index);
        try {
          await updateNagSchedule({ communityId, nagSchedule: newSchedule });
        } catch (error) {
          if (Platform.OS === "web") {
            window.alert("Failed to remove nag entry");
          } else {
            Alert.alert("Error", "Failed to remove nag entry");
          }
        }
      };

      if (Platform.OS === "web") {
        if (window.confirm(`Remove "${label}"?`)) await doRemove();
      } else {
        Alert.alert("Remove Nag", `Remove "${label}"?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doRemove },
        ]);
      }
    },
    [config, communityId, updateNagSchedule]
  );

  // ---- PCO Config Editing ----

  const handleOpenPcoEditor = useCallback(() => {
    if (!config) return;
    setEditPcoCommunityId(config.pcoConfig.communityId);
    setEditPcoServiceTypeIds({ ...(config.pcoConfig.serviceTypeIds as Record<string, string>) });
    setEditPcoRoleMappings(
      Object.fromEntries(
        Object.entries(config.pcoConfig.roleMappings as Record<string, PcoRoleMapping>).map(
          ([k, v]) => [k, { teamNamePattern: v.teamNamePattern, positionName: v.positionName }]
        )
      )
    );
    setShowPcoEditor(true);
  }, [config]);

  const handleSavePcoConfig = useCallback(async () => {
    if (!config || !communityId) return;
    try {
      await updatePcoConfig({
        communityId,
        pcoConfig: {
          communityId: editPcoCommunityId,
          serviceTypeIds: editPcoServiceTypeIds,
          roleMappings: editPcoRoleMappings,
        },
      });
      setShowPcoEditor(false);
    } catch (error) {
      Alert.alert("Error", "Failed to save PCO configuration");
    }
  }, [config, communityId, updatePcoConfig, editPcoCommunityId, editPcoServiceTypeIds, editPcoRoleMappings]);

  // ---- Service Plan Items helpers ----

  /** Get items in V2 format — use V2 if present, fallback to V1 reconstruction */
  const getV2Items = useCallback((): ServicePlanItemV2[] => {
    if (!config) return [];
    if (config.servicePlanItemsV2 && (config.servicePlanItemsV2 as ServicePlanItemV2[]).length > 0) {
      return config.servicePlanItemsV2 as ServicePlanItemV2[];
    }
    // V1 → V2 defaults for items with known plan-item sync behavior
    const PLAN_ITEM_DEFAULTS: Record<string, { pcoItemTitlePattern: string; pcoItemField: string; preserveSections?: string[] }> = {
      preachNotes: { pcoItemTitlePattern: "message|preach|sermon", pcoItemField: "description" },
      announcements: { pcoItemTitlePattern: "announcement", pcoItemField: "description", preserveSections: ["GIVING"] },
    };

    // Reconstruct from V1
    return config.servicePlanItems.map((id: string) => {
      const roleMapping = config.pcoConfig.roleMappings[id] as PcoRoleMapping | undefined;
      const planItemDefaults = PLAN_ITEM_DEFAULTS[id];

      if (roleMapping) {
        return {
          id,
          label: config.servicePlanLabels[id] || id,
          responsibleRoles: config.itemResponsibleRoles[id] || [],
          actionType: "assign_role",
          pcoTeamNamePattern: roleMapping.teamNamePattern,
          pcoPositionName: roleMapping.positionName,
        };
      }

      if (planItemDefaults) {
        return {
          id,
          label: config.servicePlanLabels[id] || id,
          responsibleRoles: config.itemResponsibleRoles[id] || [],
          actionType: "update_plan_item",
          ...planItemDefaults,
        };
      }

      return {
        id,
        label: config.servicePlanLabels[id] || id,
        responsibleRoles: config.itemResponsibleRoles[id] || [],
        actionType: "none",
      };
    });
  }, [config]);

  const handleOpenItemEditor = useCallback(
    (index: number | null) => {
      fetchPcoTeamsAndItems();
      if (index !== null) {
        const items = getV2Items();
        const item = items[index];
        setEditItemId(item.id);
        setEditItemLabel(item.label);
        setEditItemRoles([...item.responsibleRoles]);
        setEditItemActionType(item.actionType);
        setEditItemTeamPattern(item.pcoTeamNamePattern || "");
        setEditItemPositionName(item.pcoPositionName || "");
        setEditItemTitlePattern(item.pcoItemTitlePattern || "");
        setEditItemField(item.pcoItemField || "description");
        setEditItemPreserveSections((item.preserveSections || []).join(", "));
        setEditItemAiInstructions(item.aiInstructions || "");
      } else {
        setEditItemId("");
        setEditItemLabel("");
        setEditItemRoles([]);
        setEditItemActionType("none");
        setEditItemTeamPattern("");
        setEditItemPositionName("");
        setEditItemTitlePattern("");
        setEditItemField("description");
        setEditItemPreserveSections("");
        setEditItemAiInstructions("");
      }
      setEditingItemIndex(index);
      setShowItemEditor(true);
    },
    [getV2Items, fetchPcoTeamsAndItems]
  );

  const handleSaveItem = useCallback(async () => {
    if (!config || !communityId) return;
    if (!editItemLabel.trim()) {
      Alert.alert("Error", "Label is required");
      return;
    }

    const id = editItemId.trim() || editItemLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const preserveSections = editItemPreserveSections.trim()
      ? editItemPreserveSections.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const item: ServicePlanItemV2 = {
      id,
      label: editItemLabel.trim(),
      responsibleRoles: editItemRoles,
      actionType: editItemActionType,
      ...(editItemActionType === "assign_role" ? {
        pcoTeamNamePattern: editItemTeamPattern || undefined,
        pcoPositionName: editItemPositionName || undefined,
      } : {}),
      ...(editItemActionType === "update_plan_item" ? {
        pcoItemTitlePattern: editItemTitlePattern || undefined,
        pcoItemField: editItemField || undefined,
        preserveSections,
      } : {}),
      ...(editItemAiInstructions.trim() ? { aiInstructions: editItemAiInstructions.trim() } : {}),
    };

    const items = getV2Items().map(sanitizeV2Item);
    if (editingItemIndex !== null) {
      items[editingItemIndex] = item;
    } else {
      items.push(item);
    }

    try {
      await updateServicePlanItems({ communityId, items });
      setShowItemEditor(false);
    } catch (error) {
      console.error("[SlackBotConfig] Failed to save item:", error);
      Alert.alert("Error", "Failed to save service plan item");
    }
  }, [
    config, communityId, editingItemIndex, editItemId, editItemLabel, editItemRoles,
    editItemActionType, editItemTeamPattern, editItemPositionName, editItemTitlePattern,
    editItemField, editItemPreserveSections, editItemAiInstructions, getV2Items,
    updateServicePlanItems,
  ]);

  const handleRemoveItem = useCallback(
    async (index: number) => {
      if (!config || !communityId) return;
      const items = getV2Items();
      const label = items[index]?.label ?? "this item";

      const doRemove = async () => {
        const newItems = items.filter((_: ServicePlanItemV2, i: number) => i !== index).map(sanitizeV2Item);
        try {
          await updateServicePlanItems({ communityId, items: newItems });
        } catch (error) {
          console.error("[SlackBotConfig] Failed to remove item:", error);
          if (Platform.OS === "web") {
            window.alert("Failed to remove item");
          } else {
            Alert.alert("Error", "Failed to remove item");
          }
        }
      };

      if (Platform.OS === "web") {
        if (window.confirm(`Remove "${label}"?`)) {
          await doRemove();
        }
      } else {
        Alert.alert("Remove Item", `Remove "${label}"?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doRemove },
        ]);
      }
    },
    [config, communityId, getV2Items, updateServicePlanItems]
  );

  // ---- Filtered Slack members for picker ----

  const filteredSlackMembers = useMemo(() => {
    if (!memberSearch.trim()) return slackMembers;
    const q = memberSearch.toLowerCase();
    return slackMembers.filter(
      (m) =>
        m.realName.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q)
    );
  }, [slackMembers, memberSearch]);

  // Resolve slack user IDs to names for display
  const resolveSlackName = useCallback(
    (slackUserId: string): string => {
      const member = slackMembers.find((m) => m.id === slackUserId);
      if (member) return member.realName;
      const teamMember = config?.teamMembers.find(
        (m: SlackBotTeamMember) => m.slackUserId === slackUserId
      );
      return teamMember?.name ?? slackUserId.slice(0, 8);
    },
    [slackMembers, config]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  if (!config) {
    return (
      <View style={styles.centered}>
        <Ionicons name="warning-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Slack bot not configured for this community.
        </Text>
        <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
          Run the seed script to set up initial configuration.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Status Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Status</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: config.enabled ? colors.success : colors.error },
                ]}
              />
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                Bot {config.enabled ? "Enabled" : "Disabled"}
              </Text>
            </View>
            <Switch
              value={config.enabled}
              onValueChange={handleToggleBot}
              disabled={isToggling}
              trackColor={{ true: primaryColor }}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons
                name="bug-outline"
                size={18}
                color={config.devMode ? colors.warning : colors.iconSecondary}
              />
              <Text style={[styles.rowLabel, { color: colors.text }]}>Dev Mode</Text>
            </View>
            <Switch
              value={config.devMode}
              onValueChange={handleToggleDevMode}
              trackColor={{ true: colors.warning }}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push("/(user)/admin/slackbot/activity")}
          >
            <View style={styles.rowLeft}>
              <Ionicons name="list-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>Activity Log</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Slack Channel Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Slack Channel</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>
          Channel where service planning threads are posted
        </Text>
        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surface }]} onPress={handleOpenChannelPicker} activeOpacity={0.7}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="chatbubbles-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                {slackChannels.length > 0
                  ? resolveChannelName(config.slackChannelId)
                  : config.slackChannelId}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Thread Schedule Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Thread Schedule</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>
          When new weekly service planning threads are created
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Day of Week</Text>
          <View style={[styles.chipContainer, { marginTop: 6, marginBottom: 12 }]}>
            {DAY_NAMES.map((day, i) => (
              <TouchableOpacity
                key={day}
                style={[
                  styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  config.threadCreation.dayOfWeek === i && { backgroundColor: primaryColor },
                ]}
                onPress={() => handleUpdateThreadDay(i)}
              >
                <Text
                  style={[
                    styles.selectChipText, { color: colors.text },
                    config.threadCreation.dayOfWeek === i && { color: "#fff" },
                  ]}
                >
                  {day}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Hour (ET)</Text>
          <View style={[styles.chipContainer, { marginTop: 6 }]}>
            {[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => (
              <TouchableOpacity
                key={h}
                style={[
                  styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  config.threadCreation.hourET === h && { backgroundColor: primaryColor },
                ]}
                onPress={() => handleUpdateThreadHour(h)}
              >
                <Text
                  style={[
                    styles.selectChipText, { color: colors.text },
                    config.threadCreation.hourET === h && { color: "#fff" },
                  ]}
                >
                  {h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Team Members Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            Team Members ({config.teamMembers.length})
          </Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: primaryColor }]}
            onPress={handleOpenMemberPicker}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {config.teamMembers.length === 0 ? (
            <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>No team members yet. Tap "Add" to add from Slack.</Text>
          ) : (
            config.teamMembers.map((member: SlackBotTeamMember, index: number) => (
              <View key={member.slackUserId}>
                {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <TouchableOpacity
                  style={styles.memberRow}
                  onPress={() => handleEditExistingMember(member)}
                  onLongPress={() => handleRemoveMember(member.slackUserId)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: colors.text }]}>{member.name}</Text>
                    <Text style={[styles.memberDetail, { color: colors.textTertiary }]}>
                      {member.roles.join(", ")} | {member.locations.join(", ")}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Thread Mentions Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Thread Mentions</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>
          Who gets @mentioned when new service planning threads are created
        </Text>
        {AVAILABLE_LOCATIONS.map((location) => {
          const mentions = config.threadMentions[location] ?? [];
          return (
            <View key={location} style={[styles.card, { marginBottom: 8 }]}>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{location}</Text>
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: primaryColor }]}
                  onPress={() => handleOpenMentionPicker(location)}
                >
                  <Ionicons name="pencil" size={14} color="#fff" />
                  <Text style={styles.addButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
              {mentions.length > 0 && (
                <View style={styles.mentionChips}>
                  {mentions.map((id: string) => (
                    <View key={id} style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
                      <Text style={[styles.chipText, { color: colors.text }]}>{resolveSlackName(id)}</Text>
                    </View>
                  ))}
                </View>
              )}
              {mentions.length === 0 && (
                <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>No mentions configured</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Nag Schedule Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Nag Schedule</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: primaryColor }]}
            onPress={() => handleOpenNagEditor(null)}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {config.nagSchedule.map((nag: SlackBotNagEntry, index: number) => (
            <View key={`${nag.dayOfWeek}-${nag.hourET}-${nag.urgency}`}>
              {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              <TouchableOpacity
                style={styles.row}
                onPress={() => handleOpenNagEditor(index)}
                onLongPress={() => handleRemoveNagEntry(index)}
              >
                <View>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{nag.label}</Text>
                  <Text style={[styles.memberDetail, { color: colors.textTertiary }]}>
                    {DAY_NAMES[nag.dayOfWeek]} at {nag.hourET}:00 ET
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={[
                      styles.urgencyBadge,
                      {
                        backgroundColor:
                          nag.urgency === "critical"
                            ? colors.error
                            : nag.urgency === "urgent"
                              ? colors.warning
                              : nag.urgency === "direct"
                                ? colors.link
                                : colors.success,
                      },
                    ]}
                  >
                    <Text style={styles.urgencyText}>{nag.urgency}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </View>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>

      {/* Send Nag Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Send Nag Now</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>
          Manually trigger a nag for active service threads
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Location</Text>
          <View style={[styles.chipContainer, { marginTop: 6, marginBottom: 12 }]}>
            {AVAILABLE_LOCATIONS.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={[
                  styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  nagLocation === loc && { backgroundColor: primaryColor },
                ]}
                onPress={() => setNagLocation(loc)}
              >
                <Text
                  style={[
                    styles.selectChipText, { color: colors.text },
                    nagLocation === loc && { color: "#fff" },
                  ]}
                >
                  {loc}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Urgency</Text>
          <View style={[styles.chipContainer, { marginTop: 6, marginBottom: 16 }]}>
            {(["gentle", "direct", "urgent", "critical"] as const).map((u) => (
              <TouchableOpacity
                key={u}
                style={[
                  styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  nagUrgency === u && {
                    backgroundColor:
                      u === "critical"
                        ? colors.error
                        : u === "urgent"
                          ? colors.warning
                          : u === "direct"
                            ? colors.link
                            : colors.success,
                  },
                ]}
                onPress={() => setNagUrgency(u)}
              >
                <Text
                  style={[
                    styles.selectChipText, { color: colors.text },
                    nagUrgency === u && { color: "#fff" },
                  ]}
                >
                  {u}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[
              styles.sendNagButton,
              { backgroundColor: primaryColor },
              isSendingNag && { opacity: 0.6 },
            ]}
            onPress={handleSendNag}
            disabled={isSendingNag}
          >
            {isSendingNag ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="megaphone-outline" size={18} color="#fff" />
                <Text style={styles.sendNagButtonText}>Send Nag</Text>
              </>
            )}
          </TouchableOpacity>
          {nagResult && (
            <Text
              style={[
                styles.memberDetail,
                { marginTop: 10, textAlign: "center" },
                nagResult.startsWith("Failed") && { color: colors.error },
                !nagResult.startsWith("Failed") && { color: colors.success },
              ]}
            >
              {nagResult}
            </Text>
          )}
        </View>
      </View>

      {/* AI Config Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>AI Configuration</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: primaryColor }]}
            onPress={handleOpenAiEditor}
          >
            <Ionicons name="pencil" size={14} color="#fff" />
            <Text style={styles.addButtonText}>Edit</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surface }]} onPress={handleOpenAiEditor} activeOpacity={0.7}>
          <View style={styles.configRow}>
            <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Model</Text>
            <Text style={[styles.configValue, { color: colors.text }]}>{config.aiConfig.model}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.configRow}>
            <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Personality</Text>
            <Text style={[styles.configValueSmall, { color: colors.text }]} numberOfLines={3}>
              {config.aiConfig.botPersonality}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.configRow}>
            <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Response Rules</Text>
            <Text style={[styles.configValueSmall, { color: colors.text }]} numberOfLines={3}>
              {config.aiConfig.responseRules}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.configRow}>
            <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Team Context</Text>
            <Text style={[styles.configValueSmall, { color: colors.text }]} numberOfLines={2}>
              {config.aiConfig.teamContext}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* PCO Config Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Planning Center</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: primaryColor }]}
            onPress={handleOpenPcoEditor}
          >
            <Ionicons name="pencil" size={14} color="#fff" />
            <Text style={styles.addButtonText}>Edit</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.card, { backgroundColor: colors.surface }]} onPress={handleOpenPcoEditor} activeOpacity={0.7}>
          <View style={styles.configRow}>
            <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Community ID</Text>
            <Text style={[styles.configValue, { color: colors.text }]} numberOfLines={1}>
              {config.pcoConfig.communityId.slice(0, 12)}...
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {Object.entries(config.pcoConfig.serviceTypeIds as Record<string, string>).map(
            ([location, typeId]) => (
              <View key={location}>
                <View style={styles.configRow}>
                  <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{location} Service Type</Text>
                  <Text style={[styles.configValue, { color: colors.text }]}>{typeId}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>
            )
          )}
          {Object.entries(config.pcoConfig.roleMappings as Record<string, PcoRoleMapping>).map(
            ([role, mapping]) => (
              <View key={role}>
                <View style={styles.configRow}>
                  <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{role}</Text>
                  <Text style={[styles.configValueSmall, { color: colors.text }]}>
                    Team: {mapping.teamNamePattern} | Position: {mapping.positionName}
                  </Text>
                </View>
              </View>
            )
          )}
        </TouchableOpacity>
      </View>

      {/* Service Plan Items Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Service Plan Items</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: primaryColor }]}
            onPress={() => handleOpenItemEditor(null)}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {getV2Items().length === 0 ? (
            <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>No items configured. Tap "Add" to create one.</Text>
          ) : (
            getV2Items().map((item: ServicePlanItemV2, index: number) => (
              <View key={item.id}>
                {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.memberRow}>
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                    onPress={() => handleOpenItemEditor(index)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.memberName, { color: colors.text }]}>{item.label}</Text>
                      <Text style={[styles.memberDetail, { color: colors.textTertiary }]}>
                        {item.responsibleRoles.join(", ") || "no roles"}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={[
                          styles.urgencyBadge,
                          {
                            backgroundColor:
                              item.actionType === "assign_role"
                                ? colors.link
                                : item.actionType === "update_plan_item"
                                  ? colors.success
                                  : colors.textTertiary,
                          },
                        ]}
                      >
                        <Text style={styles.urgencyText}>
                          {item.actionType === "assign_role"
                            ? "Role"
                            : item.actionType === "update_plan_item"
                              ? "Item"
                              : "Track"}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleRemoveItem(index)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Last Updated */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          Last updated:{" "}
          {new Date(config.updatedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
      </View>

      {/* ---- Slack Member Picker Modal ---- */}
      <Modal
        visible={showMemberPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMemberPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowMemberPicker(false)}>
              <Text style={[styles.modalAction, { color: primaryColor }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Add Team Member</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search Slack members..."
              value={memberSearch}
              onChangeText={setMemberSearch}
              autoFocus
            />
          </View>
          {isLoadingMembers ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={primaryColor} />
          ) : (
            <FlatList
              data={filteredSlackMembers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const alreadyAdded = config?.teamMembers.some(
                  (m: SlackBotTeamMember) => m.slackUserId === item.id
                );
                return (
                  <TouchableOpacity
                    style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectSlackMember(item)}
                    disabled={alreadyAdded}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.pickerName,
                          { color: colors.text },
                          alreadyAdded && { color: colors.textTertiary },
                        ]}
                      >
                        {item.realName}
                      </Text>
                      <Text style={[styles.pickerSubtext, { color: colors.textTertiary }]}>@{item.name}</Text>
                    </View>
                    {alreadyAdded && (
                      <Text style={[styles.addedBadge, { color: colors.textTertiary }]}>Added</Text>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyListText, { color: colors.textTertiary }]}>
                  {memberSearch ? "No matching members" : "No members found"}
                </Text>
              }
            />
          )}
        </View>
      </Modal>

      {/* ---- Role/Location Editor Modal ---- */}
      <Modal
        visible={showRoleEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRoleEditor(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowRoleEditor(false)}>
              <Text style={[styles.modalAction, { color: colors.destructive }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingMember?.name ?? "Edit Member"}
            </Text>
            <TouchableOpacity onPress={handleSaveMember}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600" }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ padding: 16 }}>
            <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>Roles</Text>
            <View style={styles.chipContainer}>
              {AVAILABLE_ROLES.map((role) => {
                const selected = editingRoles.includes(role);
                return (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                      selected && { backgroundColor: primaryColor },
                    ]}
                    onPress={() => {
                      setEditingRoles((prev) =>
                        selected
                          ? prev.filter((r) => r !== role)
                          : [...prev, role]
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.selectChipText, { color: colors.text },
                        selected && { color: "#fff" },
                      ]}
                    >
                      {role}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.editorLabel, { marginTop: 24, color: colors.textSecondary }]}>Locations</Text>
            <View style={styles.chipContainer}>
              {AVAILABLE_LOCATIONS.map((loc) => {
                const selected = editingLocations.includes(loc);
                return (
                  <TouchableOpacity
                    key={loc}
                    style={[
                      styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                      selected && { backgroundColor: primaryColor },
                    ]}
                    onPress={() => {
                      setEditingLocations((prev) =>
                        selected
                          ? prev.filter((l) => l !== loc)
                          : [...prev, loc]
                      );
                    }}
                  >
                    <Text
                      style={[
                        styles.selectChipText, { color: colors.text },
                        selected && { color: "#fff" },
                      ]}
                    >
                      {loc}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ---- AI Config Editor Modal ---- */}
      <Modal
        visible={showAiEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAiEditor(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowAiEditor(false)}>
              <Text style={[styles.modalAction, { color: colors.destructive }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>AI Configuration</Text>
            <TouchableOpacity onPress={handleSaveAiConfig}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600" }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>Model</Text>
            <TextInput
              style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editAiModel}
              onChangeText={setEditAiModel}
              placeholder="e.g. gpt-4o"
              autoCapitalize="none"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Bot Personality</Text>
            <TextInput
              style={[styles.textFieldMulti, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editAiPersonality}
              onChangeText={setEditAiPersonality}
              placeholder="Describe the bot's personality..."
              multiline
              textAlignVertical="top"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Response Rules</Text>
            <TextInput
              style={[styles.textFieldMulti, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editAiRules}
              onChangeText={setEditAiRules}
              placeholder="Rules for how the bot should respond..."
              multiline
              textAlignVertical="top"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Team Context</Text>
            <TextInput
              style={[styles.textFieldMulti, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editAiTeamContext}
              onChangeText={setEditAiTeamContext}
              placeholder="Context about the team/organization..."
              multiline
              textAlignVertical="top"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Nag Tone by Level</Text>
            {["gentle", "direct", "urgent", "critical"].map((level) => (
              <View key={level} style={{ marginBottom: 12 }}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{level}</Text>
                <TextInput
                  style={[styles.textFieldMulti, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={editNagTones[level] ?? ""}
                  onChangeText={(text) =>
                    setEditNagTones((prev) => ({ ...prev, [level]: text }))
                  }
                  placeholder={`Tone for ${level} nags...`}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Nag Schedule Editor Modal ---- */}
      <Modal
        visible={showNagEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNagEditor(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowNagEditor(false)}>
              <Text style={[styles.modalAction, { color: colors.destructive }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingNagIndex !== null ? "Edit Nag" : "New Nag"}
            </Text>
            <TouchableOpacity onPress={handleSaveNagEntry}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600" }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 16 }}>
            <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>Label</Text>
            <TextInput
              style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editNagLabel}
              onChangeText={setEditNagLabel}
              placeholder="e.g. Mid-week check-in"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Day of Week</Text>
            <View style={styles.chipContainer}>
              {DAY_NAMES.map((day, i) => (
                <TouchableOpacity
                  key={day}
                  style={[
                    styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                    editNagDay === i && { backgroundColor: primaryColor },
                  ]}
                  onPress={() => setEditNagDay(i)}
                >
                  <Text
                    style={[
                      styles.selectChipText, { color: colors.text },
                      editNagDay === i && { color: "#fff" },
                    ]}
                  >
                    {day}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Hour (ET)</Text>
            <View style={styles.chipContainer}>
              {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => (
                <TouchableOpacity
                  key={h}
                  style={[
                    styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                    editNagHour === h && { backgroundColor: primaryColor },
                  ]}
                  onPress={() => setEditNagHour(h)}
                >
                  <Text
                    style={[
                      styles.selectChipText, { color: colors.text },
                      editNagHour === h && { color: "#fff" },
                    ]}
                  >
                    {h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Urgency</Text>
            <View style={styles.chipContainer}>
              {(["gentle", "direct", "urgent", "critical"] as const).map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[
                    styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                    editNagUrgency === u && {
                      backgroundColor:
                        u === "critical"
                          ? colors.error
                          : u === "urgent"
                            ? colors.warning
                            : u === "direct"
                              ? colors.link
                              : colors.success,
                    },
                  ]}
                  onPress={() => setEditNagUrgency(u)}
                >
                  <Text
                    style={[
                      styles.selectChipText, { color: colors.text },
                      editNagUrgency === u && { color: "#fff" },
                    ]}
                  >
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ---- PCO Config Editor Modal ---- */}
      <Modal
        visible={showPcoEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPcoEditor(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowPcoEditor(false)}>
              <Text style={[styles.modalAction, { color: colors.destructive }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Planning Center</Text>
            <TouchableOpacity onPress={handleSavePcoConfig}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600" }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>Community ID</Text>
            <TextInput
              style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editPcoCommunityId}
              onChangeText={setEditPcoCommunityId}
              placeholder="Convex community ID"
              autoCapitalize="none"
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Service Type IDs</Text>
            {Object.entries(editPcoServiceTypeIds).map(([location, typeId]) => (
              <View key={location} style={{ marginBottom: 12 }}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{location}</Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={typeId}
                  onChangeText={(text) =>
                    setEditPcoServiceTypeIds((prev) => ({ ...prev, [location]: text }))
                  }
                  placeholder={`PCO service type ID for ${location}`}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                />
              </View>
            ))}

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Role Mappings</Text>
            {Object.entries(editPcoRoleMappings).map(([role, mapping]) => (
              <View key={role} style={[styles.roleMappingCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Text style={[styles.configLabel, { fontSize: 15, fontWeight: "600", color: colors.textSecondary }]}>{role}</Text>
                <Text style={[styles.configLabel, { marginTop: 8, color: colors.textSecondary }]}>Team Name Pattern</Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={mapping.teamNamePattern}
                  onChangeText={(text) =>
                    setEditPcoRoleMappings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], teamNamePattern: text },
                    }))
                  }
                  placeholder="e.g. Worship"
                  autoCapitalize="none"
                />
                <Text style={[styles.configLabel, { marginTop: 8, color: colors.textSecondary }]}>Position Name</Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={mapping.positionName}
                  onChangeText={(text) =>
                    setEditPcoRoleMappings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], positionName: text },
                    }))
                  }
                  placeholder="e.g. Worship Leader"
                  autoCapitalize="none"
                />
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Service Plan Item Editor Modal ---- */}
      <Modal
        visible={showItemEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowItemEditor(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowItemEditor(false)}>
              <Text style={[styles.modalAction, { color: colors.destructive }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingItemIndex !== null ? "Edit Item" : "New Item"}
            </Text>
            <TouchableOpacity onPress={handleSaveItem}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600" }]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.editorLabel, { color: colors.textSecondary }]}>Label</Text>
            <TextInput
              style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editItemLabel}
              onChangeText={(text) => {
                setEditItemLabel(text);
                // Auto-generate ID for new items
                if (editingItemIndex === null) {
                  setEditItemId(text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
                }
              }}
              placeholder="e.g. Preacher, Service Video"
            />

            <Text style={[styles.editorLabel, { marginTop: 16, color: colors.textSecondary }]}>ID</Text>
            <TextInput
              style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }, editingItemIndex !== null && { color: colors.textTertiary }]}
              value={editItemId}
              onChangeText={setEditItemId}
              placeholder="Auto-generated from label"
              autoCapitalize="none"
              editable={editingItemIndex === null}
            />

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Responsible Roles</Text>
            <View style={styles.chipContainer}>
              {AVAILABLE_ROLES.map((role) => {
                const selected = editItemRoles.includes(role);
                return (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                      selected && { backgroundColor: primaryColor },
                    ]}
                    onPress={() => {
                      setEditItemRoles((prev) =>
                        selected ? prev.filter((r) => r !== role) : [...prev, role]
                      );
                    }}
                  >
                    <Text
                      style={[styles.selectChipText, { color: colors.text }, selected && { color: "#fff" }]}
                    >
                      {role}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>Action Type</Text>
            <View style={styles.chipContainer}>
              {([
                { key: "assign_role", label: "Assign Role" },
                { key: "update_plan_item", label: "Update Item" },
                { key: "none", label: "Track Only" },
              ] as const).map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                    editItemActionType === key && {
                      backgroundColor:
                        key === "assign_role" ? colors.link
                          : key === "update_plan_item" ? colors.success
                          : colors.textSecondary,
                    },
                  ]}
                  onPress={() => setEditItemActionType(key)}
                >
                  <Text
                    style={[
                      styles.selectChipText, { color: colors.text },
                      editItemActionType === key && { color: "#fff" },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Assign Role fields */}
            {editItemActionType === "assign_role" && (
              <View style={[styles.roleMappingCard, { marginTop: 16, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Text style={[styles.configLabel, { fontSize: 14, fontWeight: "600", color: colors.textSecondary }]}>
                  PCO Role Assignment
                </Text>
                <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>Team Name Pattern</Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={editItemTeamPattern}
                  onChangeText={setEditItemTeamPattern}
                  placeholder="e.g. platform, worship"
                  autoCapitalize="none"
                />
                {pcoTeams.length > 0 && (
                  <View style={[styles.chipContainer, { marginTop: 6 }]}>
                    {pcoTeams.map((team) => (
                      <TouchableOpacity
                        key={team.id}
                        style={[
                          styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                          editItemTeamPattern.toLowerCase() === team.name.toLowerCase() && {
                            backgroundColor: primaryColor,
                          },
                        ]}
                        onPress={() => setEditItemTeamPattern(team.name.toLowerCase())}
                      >
                        <Text
                          style={[
                            styles.selectChipText, { color: colors.text },
                            { fontSize: 12 },
                            editItemTeamPattern.toLowerCase() === team.name.toLowerCase() && {
                              color: "#fff",
                            },
                          ]}
                        >
                          {team.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>Position Name</Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={editItemPositionName}
                  onChangeText={setEditItemPositionName}
                  placeholder="e.g. Preacher, Meeting Leader"
                />
              </View>
            )}

            {/* Update Plan Item fields */}
            {editItemActionType === "update_plan_item" && (
              <View style={[styles.roleMappingCard, { marginTop: 16, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Text style={[styles.configLabel, { fontSize: 14, fontWeight: "600", color: colors.textSecondary }]}>
                  PCO Plan Item Update
                </Text>
                <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>
                  Item Title Pattern (pipe-separated)
                </Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={editItemTitlePattern}
                  onChangeText={setEditItemTitlePattern}
                  placeholder="e.g. message|preach|sermon"
                  autoCapitalize="none"
                />
                {pcoPlanItemTitles.length > 0 && (
                  <View style={[styles.chipContainer, { marginTop: 6 }]}>
                    {pcoPlanItemTitles.map((item) => (
                      <TouchableOpacity
                        key={item.title}
                        style={[
                          styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                          editItemTitlePattern.toLowerCase().includes(item.title.toLowerCase()) && {
                            backgroundColor: primaryColor,
                          },
                        ]}
                        onPress={() => {
                          const current = editItemTitlePattern.trim();
                          if (current) {
                            setEditItemTitlePattern(`${current}|${item.title.toLowerCase()}`);
                          } else {
                            setEditItemTitlePattern(item.title.toLowerCase());
                          }
                        }}
                      >
                        <Text
                          style={[
                            styles.selectChipText, { color: colors.text },
                            { fontSize: 12 },
                            editItemTitlePattern.toLowerCase().includes(item.title.toLowerCase()) && {
                              color: "#fff",
                            },
                          ]}
                        >
                          {item.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>Field to Update</Text>
                <View style={styles.chipContainer}>
                  {(["description", "notes"] as const).map((field) => (
                    <TouchableOpacity
                      key={field}
                      style={[
                        styles.selectChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                        editItemField === field && { backgroundColor: primaryColor },
                      ]}
                      onPress={() => setEditItemField(field)}
                    >
                      <Text
                        style={[
                          styles.selectChipText, { color: colors.text },
                          editItemField === field && { color: "#fff" },
                        ]}
                      >
                        {field}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.configLabel, { marginTop: 10, color: colors.textSecondary }]}>
                  Preserve Sections (comma-separated)
                </Text>
                <TextInput
                  style={[styles.textFieldSingle, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                  value={editItemPreserveSections}
                  onChangeText={setEditItemPreserveSections}
                  placeholder="e.g. GIVING"
                  autoCapitalize="characters"
                />
              </View>
            )}

            <Text style={[styles.editorLabel, { marginTop: 20, color: colors.textSecondary }]}>AI Instructions (optional)</Text>
            <TextInput
              style={[styles.textFieldMulti, { backgroundColor: colors.surfaceSecondary, color: colors.text }]}
              value={editItemAiInstructions}
              onChangeText={setEditItemAiInstructions}
              placeholder="Special instructions for the AI when handling this item..."
              multiline
              textAlignVertical="top"
            />

            {isLoadingPcoData && (
              <View style={{ alignItems: "center", marginTop: 12 }}>
                <ActivityIndicator size="small" color={primaryColor} />
                <Text style={[styles.memberDetail, { marginTop: 4, color: colors.textTertiary }]}>Loading PCO data...</Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ---- Thread Mention Picker Modal ---- */}
      <Modal
        visible={showMentionPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMentionPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowMentionPicker(false)}>
              <Text style={[styles.modalAction, { color: primaryColor }]}>Done</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{mentionLocation} Mentions</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search members..."
              value={memberSearch}
              onChangeText={setMemberSearch}
            />
          </View>
          {isLoadingMembers ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={primaryColor} />
          ) : (
            <FlatList
              data={filteredSlackMembers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isMentioned = (config?.threadMentions[mentionLocation] ?? []).includes(
                  item.id
                );
                return (
                  <TouchableOpacity
                    style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleToggleMention(item.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerName, { color: colors.text }]}>{item.realName}</Text>
                      <Text style={[styles.pickerSubtext, { color: colors.textTertiary }]}>@{item.name}</Text>
                    </View>
                    <Ionicons
                      name={isMentioned ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={isMentioned ? primaryColor : colors.iconSecondary}
                    />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyListText, { color: colors.textTertiary }]}>
                  {memberSearch ? "No matching members" : "No members found"}
                </Text>
              }
            />
          )}
        </View>
      </Modal>
      {/* ---- Channel Picker Modal ---- */}
      <Modal
        visible={showChannelPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowChannelPicker(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowChannelPicker(false)}>
              <Text style={[styles.modalAction, { color: primaryColor }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Channel</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="search" size={18} color={colors.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search channels..."
              value={channelSearch}
              onChangeText={setChannelSearch}
              autoFocus
            />
          </View>
          {isLoadingChannels ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={primaryColor} />
          ) : (
            <FlatList
              data={filteredChannels}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isSelected = config?.slackChannelId === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectChannel(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.pickerName,
                          { color: colors.text },
                          isSelected && { color: primaryColor, fontWeight: "600" },
                        ]}
                      >
                        #{item.name}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={24} color={primaryColor} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyListText, { color: colors.textTertiary }]}>
                  {channelSearch ? "No matching channels" : "No channels found"}
                </Text>
              }
            />
          )}
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  emptyCardText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    fontSize: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  deleteButton: {
    marginLeft: 12,
    padding: 4,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberDetail: {
    fontSize: 13,
    marginTop: 2,
  },
  mentionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chipText: {
    fontSize: 13,
  },
  urgencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  urgencyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  configRow: {
    paddingVertical: 4,
  },
  configLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  configValue: {
    fontSize: 15,
  },
  configValueSmall: {
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    padding: 20,
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  modalAction: {
    fontSize: 16,
    minWidth: 60,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerName: {
    fontSize: 16,
  },
  pickerSubtext: {
    fontSize: 13,
    marginTop: 1,
  },
  addedBadge: {
    fontSize: 13,
    fontStyle: "italic",
  },
  emptyListText: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
  // Role editor styles
  editorLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  selectChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  textFieldSingle: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 4,
  },
  textFieldMulti: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 80,
    marginTop: 4,
    lineHeight: 22,
  },
  sendNagButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  sendNagButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  roleMappingCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
