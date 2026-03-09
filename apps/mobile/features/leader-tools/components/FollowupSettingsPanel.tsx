import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Pressable,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import {
  SUBTITLE_VARIABLES,
  normalizeSubtitleVariableIds,
} from "./followupShared";
import {
  formatFollowupRefreshTimestamp,
  getFollowupRefreshButtonLabel,
  type FollowupRefreshStateSnapshot,
} from "./followupRefreshState";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useQuery,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { CustomFieldDef } from "./ColumnPickerModal";

// ============================================================================
// Types
// ============================================================================

interface FollowupSettingsPanelProps {
  groupId: string;
  onClose: () => void;
}

interface VariableInfo {
  id: string;
  label: string;
  description: string;
  category: string;
}

interface ScoreVariable {
  variableId: string;
  weight: number;
}

interface ScoreDefinition {
  id: string;
  name: string;
  variables: ScoreVariable[];
}

interface AlertDefinition {
  id: string;
  variableId: string;
  operator: string;
  threshold: number;
  label?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SCORES: ScoreDefinition[] = [
  {
    id: "default_attendance",
    name: "Attendance",
    variables: [{ variableId: "attendance_pct", weight: 1 }],
  },
  {
    id: "default_connection",
    name: "Connection",
    variables: [
      { variableId: "attendance_streak", weight: 1 },
      { variableId: "followup_recency", weight: 1 },
    ],
  },
];

const SLOT_CANDIDATES: Record<string, string[]> = {
  text: ["customText1", "customText2", "customText3", "customText4", "customText5"],
  dropdown: ["customText1", "customText2", "customText3", "customText4", "customText5"],
  number: ["customNum1", "customNum2", "customNum3", "customNum4", "customNum5"],
  boolean: ["customBool1", "customBool2", "customBool3", "customBool4", "customBool5"],
};

const SLOT_CAPACITIES: Record<string, { label: string; total: number; types: string[] }> = {
  text: { label: "Text/Dropdown", total: 5, types: ["text", "dropdown"] },
  number: { label: "Number", total: 5, types: ["number"] },
  boolean: { label: "Checkbox", total: 5, types: ["boolean"] },
};

function getNextAvailableSlot(type: string, usedSlots: Set<string>): string | null {
  return (SLOT_CANDIDATES[type] ?? []).find((s) => !usedSlots.has(s)) ?? null;
}

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
] as const;

const SYSTEM_COLUMNS = new Set(["checkbox", "rowNum"]);

// ============================================================================
// Component
// ============================================================================

export function FollowupSettingsPanel({ groupId, onClose }: FollowupSettingsPanelProps) {
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;

  // Accordion state — all collapsed by default
  const [displayNameOpen, setDisplayNameOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);

  // ── Data queries ──

  const config = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    { groupId: groupId as Id<"groups"> }
  ) as any;

  const availableVariables = useQuery(
    api.functions.followupScoring.getAvailableVariables
  ) as VariableInfo[] | undefined;

  // ── Mutations ──

  const updateDisplayNameMut = useAuthenticatedMutation(
    api.functions.groups.mutations.updateToolDisplayName
  );
  const saveColumnConfigMut = useAuthenticatedMutation(
    api.functions.groups.mutations.saveFollowupColumnConfig
  );
  const updateScoreConfig = useAuthenticatedMutation(
    api.functions.groups.mutations.updateFollowupScoreConfig
  );
  const refreshFollowupScoresMut = useAuthenticatedMutation(
    api.functions.groups.mutations.refreshFollowupScores
  );

  // ── Display Name state ──

  const [toolDisplayName, setToolDisplayName] = useState("");
  const [isRefreshingScores, setIsRefreshingScores] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    const names = (groupData as any)?.toolDisplayNames as Record<string, string> | undefined;
    setToolDisplayName(names?.followup ?? "");
  }, [(groupData as any)?.toolDisplayNames]);

  const handleDisplayNameBlur = useCallback(async () => {
    try {
      await updateDisplayNameMut({
        groupId: groupId as Id<"groups">,
        toolId: "followup",
        displayName: toolDisplayName.trim() || undefined,
      });
    } catch (err) {
      console.error("[updateToolDisplayName] failed:", err);
    }
  }, [groupId, toolDisplayName, updateDisplayNameMut]);

  const handleRefreshFollowupScores = useCallback(async () => {
    setIsRefreshingScores(true);
    setRefreshMessage(null);
    try {
      const result = await refreshFollowupScoresMut({
        groupId: groupId as Id<"groups">,
      });
      if ((result as any)?.alreadyRunning) {
        setRefreshMessage("Refresh already in progress.");
      } else {
        setRefreshMessage("Refresh started. Scores and denormalized fields are updating now.");
      }
    } catch (err) {
      console.error("[refreshFollowupScores] failed:", err);
      setRefreshMessage("Could not start refresh. Please try again.");
    } finally {
      setIsRefreshingScores(false);
    }
  }, [groupId, refreshFollowupScoresMut]);

  // ── Columns state ──

  const scoreConfigScores = config?.scoreConfigScores ?? [];
  const columnConfig = config?.followupColumnConfig ?? null;
  const refreshState = (config as any)?.followupRefreshState as FollowupRefreshStateSnapshot;
  const refreshInProgress = refreshState?.status === "running";
  const refreshStartedLabel = formatFollowupRefreshTimestamp(refreshState?.startedAt);
  const refreshCompletedLabel = formatFollowupRefreshTimestamp(refreshState?.completedAt);
  const initialCustomFields: CustomFieldDef[] = (columnConfig?.customFields ?? []) as CustomFieldDef[];

  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "boolean" | "dropdown">("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [isSavingColumns, setIsSavingColumns] = useState(false);

  // Build allColumnsForPicker from config data
  const allColumnsForPicker = useMemo(() => {
    const cols: { key: string; label: string }[] = [
      { key: "addedAt", label: "Date Added" },
      { key: "firstName", label: "First Name" },
      { key: "lastName", label: "Last Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "zipCode", label: "ZIP Code" },
      { key: "dateOfBirth", label: "Birthday" },
    ];
    scoreConfigScores.forEach((sc: { id: string; name: string }, i: number) => {
      cols.push({ key: `score${i + 1}`, label: sc.name });
    });
    cols.push(
      { key: "assignee", label: "Assignee" },
      { key: "notes", label: "Notes" },
      { key: "status", label: "Status" },
      { key: "lastAttendedAt", label: "Last Attended" },
      { key: "lastFollowupAt", label: "Last Follow-up" },
      { key: "lastActiveAt", label: "Date Active" },
      { key: "alerts", label: "Alerts" },
    );
    for (const cf of customFields) {
      cols.push({ key: cf.slot, label: cf.name });
    }
    return cols;
  }, [scoreConfigScores, customFields]);

  // Initialize column state from config
  useEffect(() => {
    if (!config) return;
    const allKeys = allColumnsForPicker.map((c) => c.key).filter((k) => !SYSTEM_COLUMNS.has(k));
    const savedOrder = columnConfig?.columnOrder ?? [];
    if (savedOrder.length > 0) {
      const orderSet = new Set(savedOrder);
      const merged = [...savedOrder.filter((k: string) => allKeys.includes(k))];
      for (const k of allKeys) {
        if (!orderSet.has(k)) merged.push(k);
      }
      setColumnOrder(merged);
    } else {
      setColumnOrder(allKeys);
    }
    setHiddenColumns(new Set(columnConfig?.hiddenColumns ?? []));
    setCustomFields([...initialCustomFields]);
  }, [config]);

  const usedSlots = useMemo(
    () => new Set(customFields.map((f) => f.slot)),
    [customFields]
  );

  const labelMap = useMemo(() => {
    const map = new Map(allColumnsForPicker.map((c) => [c.key, c.label]));
    for (const f of customFields) {
      map.set(f.slot, f.name);
    }
    return map;
  }, [allColumnsForPicker, customFields]);

  const moveColumn = useCallback((idx: number, direction: -1 | 1) => {
    setColumnOrder((prev) => {
      const newOrder = [...prev];
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= newOrder.length) return prev;
      [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
      return newOrder;
    });
  }, []);

  const toggleVisibility = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleAddField = useCallback(() => {
    if (!newFieldName.trim()) return;
    const slot = getNextAvailableSlot(newFieldType, usedSlots);
    if (!slot) return;

    const newField: CustomFieldDef = {
      slot,
      name: newFieldName.trim(),
      type: newFieldType,
      ...(newFieldType === "dropdown" && newFieldOptions.length > 0
        ? { options: newFieldOptions.filter((o) => o.trim()) }
        : {}),
    };

    setCustomFields((prev) => [...prev, newField]);
    setColumnOrder((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldOptions([]);
    setShowAddField(false);
  }, [newFieldName, newFieldType, newFieldOptions, usedSlots]);

  const handleDeleteField = useCallback((idx: number) => {
    setCustomFields((prev) => {
      const field = prev[idx];
      setColumnOrder((order) => order.filter((k) => k !== field.slot));
      setHiddenColumns((hidden) => {
        const next = new Set(hidden);
        next.delete(field.slot);
        return next;
      });
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const canAddType = useCallback(
    (type: string): boolean => getNextAvailableSlot(type, usedSlots) !== null,
    [usedSlots]
  );

  const capacityInfo = useMemo(() => {
    const slotsByPrefix: Record<string, number> = { text: 0, number: 0, boolean: 0 };
    for (const f of customFields) {
      if (f.slot.startsWith("customText")) slotsByPrefix.text++;
      else if (f.slot.startsWith("customNum")) slotsByPrefix.number++;
      else if (f.slot.startsWith("customBool")) slotsByPrefix.boolean++;
    }
    return slotsByPrefix;
  }, [customFields]);

  const handleSaveColumns = useCallback(async () => {
    setIsSavingColumns(true);
    try {
      await saveColumnConfigMut({
        groupId: groupId as Id<"groups">,
        followupColumnConfig: {
          columnOrder,
          hiddenColumns: [...hiddenColumns],
          customFields,
        },
      });
    } catch (err) {
      console.error("[saveFollowupColumnConfig] failed:", err);
    } finally {
      setIsSavingColumns(false);
    }
  }, [groupId, columnOrder, hiddenColumns, customFields, saveColumnConfigMut]);

  // ── Scores state ──

  const [scores, setScores] = useState<ScoreDefinition[]>(DEFAULT_SCORES);
  const [alerts, setAlerts] = useState<AlertDefinition[]>([]);
  const [subtitleVars, setSubtitleVars] = useState<string[]>([]);
  const [hasScoreChanges, setHasScoreChanges] = useState(false);
  const [savingScores, setSavingScores] = useState(false);
  const [showSavedMessage, setShowSavedMessage] = useState(false);

  // Inline variable picker state
  const [addVariableTarget, setAddVariableTarget] = useState<number | null>(null);
  const [alertVariablePickerIndex, setAlertVariablePickerIndex] = useState<number | null>(null);

  // Initialize scores from group data
  useEffect(() => {
    if (groupData?.followupScoreConfig?.scores) {
      setScores(groupData.followupScoreConfig.scores);
    }
    const savedSubtitle = groupData?.followupScoreConfig?.memberSubtitle ?? "";
    setSubtitleVars(normalizeSubtitleVariableIds(savedSubtitle));
    setAlerts(groupData?.followupScoreConfig?.alerts ?? []);
  }, [groupData?.followupScoreConfig]);

  const variableMap = useMemo(() => {
    if (!availableVariables) return new Map<string, VariableInfo>();
    return new Map(availableVariables.map((v) => [v.id, v]));
  }, [availableVariables]);

  const variablesByCategory = useMemo(() => {
    if (!availableVariables) return new Map<string, VariableInfo[]>();
    const map = new Map<string, VariableInfo[]>();
    for (const v of availableVariables) {
      const list = map.get(v.category) || [];
      list.push(v);
      map.set(v.category, list);
    }
    return map;
  }, [availableVariables]);

  const handleScoreNameChange = useCallback((scoreIndex: number, name: string) => {
    const trimmed = name.slice(0, 12);
    setScores((prev) => {
      const updated = [...prev];
      updated[scoreIndex] = { ...updated[scoreIndex], name: trimmed };
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleWeightChange = useCallback((scoreIndex: number, varIndex: number, delta: number) => {
    setScores((prev) => {
      const updated = [...prev];
      const score = { ...updated[scoreIndex] };
      const variables = [...score.variables];
      const newWeight = Math.max(1, Math.min(5, variables[varIndex].weight + delta));
      variables[varIndex] = { ...variables[varIndex], weight: newWeight };
      score.variables = variables;
      updated[scoreIndex] = score;
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleRemoveVariable = useCallback((scoreIndex: number, varIndex: number) => {
    setScores((prev) => {
      const updated = [...prev];
      const score = { ...updated[scoreIndex] };
      score.variables = score.variables.filter((_, i) => i !== varIndex);
      updated[scoreIndex] = score;
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleAddVariable = useCallback((scoreIndex: number, variableId: string) => {
    setScores((prev) => {
      const updated = [...prev];
      const score = { ...updated[scoreIndex] };
      if (score.variables.some((v) => v.variableId === variableId)) return prev;
      score.variables = [...score.variables, { variableId, weight: 1 }];
      updated[scoreIndex] = score;
      return updated;
    });
    setHasScoreChanges(true);
    setAddVariableTarget(null);
  }, []);

  const handleAddScore = useCallback(() => {
    setScores((prev) => {
      if (prev.length >= 4) return prev;
      const newId = `custom_score_${Date.now()}`;
      return [
        ...prev,
        { id: newId, name: `Score ${prev.length + 1}`, variables: [{ variableId: "attendance_pct", weight: 1 }] },
      ];
    });
    setHasScoreChanges(true);
  }, []);

  const handleRemoveScore = useCallback((scoreIndex: number) => {
    setScores((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== scoreIndex);
    });
    setHasScoreChanges(true);
  }, []);

  const getUsedVariableIds = useCallback(
    (scoreIndex: number) => new Set(scores[scoreIndex]?.variables.map((v) => v.variableId) ?? []),
    [scores]
  );

  // ── Alert handlers ──

  const handleAddAlert = useCallback(() => {
    const firstVar = availableVariables?.[0]?.id ?? "attendance_pct";
    setAlerts((prev) => [
      ...prev,
      { id: `alert_${Date.now()}`, variableId: firstVar, operator: "above", threshold: 0 },
    ]);
    setHasScoreChanges(true);
  }, [availableVariables]);

  const handleRemoveAlert = useCallback((index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
    setHasScoreChanges(true);
  }, []);

  const handleAlertVariableChange = useCallback((index: number, variableId: string) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], variableId };
      return updated;
    });
    setHasScoreChanges(true);
    setAlertVariablePickerIndex(null);
  }, []);

  const handleAlertOperatorToggle = useCallback((index: number) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        operator: updated[index].operator === "above" ? "below" : "above",
      };
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleAlertThresholdChange = useCallback((index: number, text: string) => {
    const num = parseFloat(text);
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], threshold: isNaN(num) ? 0 : num };
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleAlertLabelChange = useCallback((index: number, label: string) => {
    setAlerts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], label: label || undefined };
      return updated;
    });
    setHasScoreChanges(true);
  }, []);

  const handleResetToDefaults = useCallback(() => {
    setScores(DEFAULT_SCORES);
    setAlerts([]);
    setSubtitleVars([]);
    setHasScoreChanges(true);
  }, []);

  const handleSaveScores = useCallback(async () => {
    setSavingScores(true);
    try {
      const isDefault =
        JSON.stringify(scores) === JSON.stringify(DEFAULT_SCORES) &&
        subtitleVars.length === 0 &&
        alerts.length === 0;

      await updateScoreConfig({
        groupId: groupId as Id<"groups">,
        followupScoreConfig: isDefault
          ? undefined
          : {
              scores,
              memberSubtitle: subtitleVars.length > 0 ? subtitleVars.join(",") : undefined,
              alerts: alerts.length > 0 ? alerts : undefined,
            },
      });
      setHasScoreChanges(false);
      setShowSavedMessage(true);
      setTimeout(() => setShowSavedMessage(false), 8000);
    } catch (err) {
      console.error("[updateFollowupScoreConfig] failed:", err);
    } finally {
      setSavingScores(false);
    }
  }, [groupId, scores, alerts, subtitleVars, updateScoreConfig]);

  // ── Subtitle handler ──

  const handleSubtitleToggle = useCallback((varId: string) => {
    setSubtitleVars((prev) => {
      if (prev.includes(varId)) {
        return prev.filter((id) => id !== varId);
      }
      if (prev.length >= 2) return prev;
      return [...prev, varId];
    });
    setHasScoreChanges(true);
  }, []);

  // ── Loading ──

  if (!config || !groupData || !availableVariables) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={themeColor} />
        </View>
      </View>
    );
  }

  // ── Render helpers ──

  const renderSectionHeader = (
    title: string,
    isOpen: boolean,
    onToggle: () => void,
    extra?: React.ReactNode,
  ) => (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? "chevron-down" : "chevron-forward"}
        size={14}
        color="#9CA3AF"
      />
      <Text style={styles.sectionHeaderText}>{title}</Text>
      {extra}
    </TouchableOpacity>
  );

  const renderInlineVariablePicker = (
    scoreIndex: number,
    onSelect: (variableId: string) => void,
    onClose: () => void,
  ) => {
    const usedIds = getUsedVariableIds(scoreIndex);
    return (
      <View style={styles.inlinePicker}>
        <View style={styles.inlinePickerHeader}>
          <Text style={styles.inlinePickerTitle}>Add Variable</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={18} color="#6B7280" />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.inlinePickerScroll} nestedScrollEnabled bounces={false}>
          {Array.from(variablesByCategory.entries()).map(([category, variables]) => (
            <View key={category}>
              <Text style={styles.categoryHeader}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </Text>
              {variables.map((v) => {
                const isUsed = usedIds.has(v.id);
                return (
                  <Pressable
                    key={v.id}
                    style={[styles.pickerRow, isUsed && styles.pickerRowDisabled]}
                    onPress={() => !isUsed && onSelect(v.id)}
                    disabled={isUsed}
                  >
                    <Text style={[styles.pickerLabel, isUsed && styles.pickerLabelDisabled]}>
                      {v.label}
                    </Text>
                    <Text style={styles.pickerDesc}>{v.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderAlertVariablePicker = (
    onSelect: (variableId: string) => void,
    onClose: () => void,
  ) => (
    <View style={styles.inlinePicker}>
      <View style={styles.inlinePickerHeader}>
        <Text style={styles.inlinePickerTitle}>Select Variable</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={18} color="#6B7280" />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.inlinePickerScroll} nestedScrollEnabled bounces={false}>
        {Array.from(variablesByCategory.entries()).map(([category, variables]) => (
          <View key={category}>
            <Text style={styles.categoryHeader}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </Text>
            {variables.map((v) => (
              <Pressable key={v.id} style={styles.pickerRow} onPress={() => onSelect(v.id)}>
                <Text style={styles.pickerLabel}>{v.label}</Text>
                <Text style={styles.pickerDesc}>{v.description}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={22} color="#374151" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* ── Section 1: Display Name ── */}
        {renderSectionHeader("Display Name", displayNameOpen, () => setDisplayNameOpen((p) => !p))}
        {displayNameOpen && (
          <View style={styles.sectionBody}>
            <TextInput
              style={[
                styles.textInput,
                Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
              ]}
              value={toolDisplayName}
              onChangeText={setToolDisplayName}
              onBlur={handleDisplayNameBlur}
              placeholder="Follow-up"
              placeholderTextColor="#9CA3AF"
              maxLength={20}
            />
            <Text style={styles.hintText}>
              Customize what this tool is called. Leave empty for default.
            </Text>
          </View>
        )}

        {/* ── Section 2: Columns ── */}
        {renderSectionHeader("Data", dataOpen, () => setDataOpen((p) => !p))}
        {dataOpen && (
          <View style={styles.sectionBody}>
            <TouchableOpacity
              onPress={handleRefreshFollowupScores}
              style={[
                styles.saveButton,
                { backgroundColor: themeColor },
                (isRefreshingScores || refreshInProgress) && styles.btnDisabled,
              ]}
              disabled={isRefreshingScores || refreshInProgress}
            >
              {isRefreshingScores || refreshInProgress ? (
                <View style={styles.refreshButtonBusy}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.saveButtonText}>
                    {getFollowupRefreshButtonLabel(isRefreshingScores, refreshInProgress)}
                  </Text>
                </View>
              ) : (
                <Text style={styles.saveButtonText}>Refresh Follow-up Table Now</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.hintText}>
              Rebuilds this group's denormalized follow-up rows immediately.
            </Text>
            {refreshMessage && <Text style={styles.hintText}>{refreshMessage}</Text>}
            {refreshInProgress && (
              <Text style={styles.hintText}>
                {refreshStartedLabel
                  ? `A refresh is currently underway (started ${refreshStartedLabel}).`
                  : "A refresh is currently underway."}
              </Text>
            )}
            {refreshState?.status === "idle" && refreshCompletedLabel && (
              <Text style={styles.hintText}>Last refresh completed {refreshCompletedLabel}.</Text>
            )}
            {refreshState?.status === "failed" && (
              <Text style={styles.hintError}>
                Refresh failed{refreshState.error ? `: ${refreshState.error}` : "."}
              </Text>
            )}
          </View>
        )}

        {/* ── Section 3: Columns ── */}
        {renderSectionHeader("Columns", columnsOpen, () => setColumnsOpen((p) => !p))}
        {columnsOpen && (
          <View style={styles.sectionBody}>
            {/* Column order & visibility */}
            <View style={styles.columnList}>
              {columnOrder.map((key, idx) => {
                const label = labelMap.get(key) ?? key;
                const isHidden = hiddenColumns.has(key);
                return (
                  <View key={key} style={styles.columnRow}>
                    <View style={styles.columnArrows}>
                      <TouchableOpacity
                        onPress={() => moveColumn(idx, -1)}
                        disabled={idx === 0}
                        style={styles.arrowBtn}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={14}
                          color={idx === 0 ? "#D1D5DB" : "#6B7280"}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveColumn(idx, 1)}
                        disabled={idx === columnOrder.length - 1}
                        style={styles.arrowBtn}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={14}
                          color={idx === columnOrder.length - 1 ? "#D1D5DB" : "#6B7280"}
                        />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.columnLabel, isHidden && styles.columnLabelHidden]} numberOfLines={1}>
                      {label}
                    </Text>
                    <TouchableOpacity onPress={() => toggleVisibility(key)} style={styles.eyeBtn}>
                      <Ionicons
                        name={isHidden ? "eye-off-outline" : "eye-outline"}
                        size={16}
                        color={isHidden ? "#D1D5DB" : "#6B7280"}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Custom Fields subsection */}
            <View style={styles.subsectionDivider} />
            <Text style={styles.subsectionTitle}>Custom Fields</Text>

            {/* Capacity indicators */}
            <View style={styles.capacityRow}>
              {Object.entries(SLOT_CAPACITIES).map(([key, info]) => (
                <View key={key} style={styles.capacityBadge}>
                  <Text style={styles.capacityText}>
                    {info.label}: {capacityInfo[key] ?? 0}/{info.total}
                  </Text>
                </View>
              ))}
            </View>

            {/* Existing custom fields */}
            {customFields.map((field, idx) => (
              <View key={field.slot} style={styles.fieldRow}>
                <View style={styles.fieldInfo}>
                  <Text style={styles.fieldName}>{field.name}</Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{field.type}</Text>
                  </View>
                  {field.type === "dropdown" && field.options && (
                    <Text style={styles.fieldOptions} numberOfLines={1}>
                      ({field.options.join(", ")})
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => handleDeleteField(idx)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}

            {/* Add custom field form */}
            {showAddField ? (
              <View style={styles.addFieldForm}>
                <TextInput
                  style={[
                    styles.fieldInput,
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newFieldName}
                  onChangeText={setNewFieldName}
                  placeholder="Field name..."
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                />
                <View style={styles.typePickerRow}>
                  {FIELD_TYPES.map((ft) => {
                    const enabled = canAddType(ft.value);
                    const isActive = newFieldType === ft.value;
                    return (
                      <TouchableOpacity
                        key={ft.value}
                        style={[
                          styles.typeOption,
                          isActive && { borderColor: themeColor, backgroundColor: `${themeColor}10` },
                          !enabled && styles.typeOptionDisabled,
                        ]}
                        onPress={() => enabled && setNewFieldType(ft.value)}
                        disabled={!enabled}
                      >
                        <Text
                          style={[
                            styles.typeOptionText,
                            isActive && { color: themeColor, fontWeight: "600" as const },
                            !enabled && styles.typeOptionTextDisabled,
                          ]}
                        >
                          {ft.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Dropdown options editor */}
                {newFieldType === "dropdown" && (
                  <View style={styles.optionsEditor}>
                    <Text style={styles.optionsLabel}>Options:</Text>
                    {newFieldOptions.map((opt, i) => (
                      <View key={i} style={styles.optionRow}>
                        <TextInput
                          style={[
                            styles.optionInput,
                            Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                          ]}
                          value={opt}
                          onChangeText={(text) => {
                            const next = [...newFieldOptions];
                            next[i] = text;
                            setNewFieldOptions(next);
                          }}
                          placeholder={`Option ${i + 1}`}
                          placeholderTextColor="#9CA3AF"
                        />
                        <TouchableOpacity
                          onPress={() => setNewFieldOptions(newFieldOptions.filter((_, j) => j !== i))}
                          style={styles.optionDeleteBtn}
                        >
                          <Ionicons name="close-circle" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={() => setNewFieldOptions([...newFieldOptions, ""])}
                      style={styles.addOptionBtn}
                    >
                      <Ionicons name="add" size={12} color={themeColor} />
                      <Text style={[styles.addOptionText, { color: themeColor }]}>Add option</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.addFieldActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAddField(false);
                      setNewFieldName("");
                      setNewFieldType("text");
                      setNewFieldOptions([]);
                    }}
                    style={styles.cancelFieldBtn}
                  >
                    <Text style={styles.cancelFieldText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAddField}
                    style={[
                      styles.confirmFieldBtn,
                      { backgroundColor: themeColor },
                      (!newFieldName.trim() || !canAddType(newFieldType)) && styles.btnDisabled,
                    ]}
                    disabled={!newFieldName.trim() || !canAddType(newFieldType)}
                  >
                    <Text style={styles.confirmFieldText}>Add Field</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowAddField(true)} style={styles.addFieldButton}>
                <Ionicons name="add-circle-outline" size={16} color={themeColor} />
                <Text style={[styles.addFieldButtonText, { color: themeColor }]}>Add Custom Field</Text>
              </TouchableOpacity>
            )}

            {/* Save columns button */}
            <TouchableOpacity
              onPress={handleSaveColumns}
              style={[styles.saveButton, { backgroundColor: themeColor }, isSavingColumns && styles.btnDisabled]}
              disabled={isSavingColumns}
            >
              {isSavingColumns ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Columns</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Section 4: Scores ── */}
        {renderSectionHeader("Scores", scoresOpen, () => setScoresOpen((p) => !p))}
        {scoresOpen && (
          <View style={styles.sectionBody}>
            {scores.map((score, scoreIndex) => (
              <View key={score.id} style={styles.scoreCard}>
                {/* Score name */}
                <View style={styles.scoreNameRow}>
                  <Text style={styles.scoreIndexLabel}>Score {scoreIndex + 1}</Text>
                  <View style={styles.scoreNameInputContainer}>
                    <TextInput
                      style={[
                        styles.scoreNameInput,
                        Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                      ]}
                      value={score.name}
                      onChangeText={(text) => handleScoreNameChange(scoreIndex, text)}
                      maxLength={12}
                      placeholder="Score name"
                      placeholderTextColor="#9CA3AF"
                    />
                    <Text style={styles.charCount}>{score.name.length}/12</Text>
                  </View>
                  {scores.length > 1 && (
                    <TouchableOpacity
                      style={styles.removeScoreBtn}
                      onPress={() => handleRemoveScore(scoreIndex)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Variables */}
                {score.variables.map((variable, varIndex) => {
                  const info = variableMap.get(variable.variableId);
                  return (
                    <View key={variable.variableId} style={styles.variableRow}>
                      <View style={styles.variableInfo}>
                        <Text style={styles.variableLabel} numberOfLines={1}>
                          {info?.label ?? variable.variableId}
                        </Text>
                        <Text style={styles.variableDesc} numberOfLines={1}>
                          {info?.description ?? ""}
                        </Text>
                      </View>
                      <View style={styles.weightControl}>
                        <TouchableOpacity
                          style={styles.weightBtn}
                          onPress={() => handleWeightChange(scoreIndex, varIndex, -1)}
                          disabled={variable.weight <= 1}
                        >
                          <Ionicons
                            name="remove"
                            size={14}
                            color={variable.weight <= 1 ? "#D1D5DB" : themeColor}
                          />
                        </TouchableOpacity>
                        <Text style={styles.weightValue}>{variable.weight}</Text>
                        <TouchableOpacity
                          style={styles.weightBtn}
                          onPress={() => handleWeightChange(scoreIndex, varIndex, 1)}
                          disabled={variable.weight >= 5}
                        >
                          <Ionicons
                            name="add"
                            size={14}
                            color={variable.weight >= 5 ? "#D1D5DB" : themeColor}
                          />
                        </TouchableOpacity>
                      </View>
                      {score.variables.length > 1 && (
                        <TouchableOpacity
                          style={styles.removeVarBtn}
                          onPress={() => handleRemoveVariable(scoreIndex, varIndex)}
                        >
                          <Ionicons name="close-circle" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}

                {/* Add variable */}
                {addVariableTarget === scoreIndex ? (
                  renderInlineVariablePicker(
                    scoreIndex,
                    (variableId) => handleAddVariable(scoreIndex, variableId),
                    () => setAddVariableTarget(null),
                  )
                ) : (
                  <TouchableOpacity
                    style={styles.addVariableBtn}
                    onPress={() => setAddVariableTarget(scoreIndex)}
                  >
                    <Ionicons name="add-circle-outline" size={14} color={themeColor} />
                    <Text style={[styles.addVariableBtnText, { color: themeColor }]}>Add Variable</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {/* Add score */}
            {scores.length < 4 && (
              <TouchableOpacity style={styles.addScoreBtn} onPress={handleAddScore}>
                <Ionicons name="add-circle-outline" size={16} color={themeColor} />
                <Text style={[styles.addScoreBtnText, { color: themeColor }]}>Add Score</Text>
              </TouchableOpacity>
            )}

            {/* Reset to defaults */}
            <TouchableOpacity style={styles.resetBtn} onPress={handleResetToDefaults}>
              <Ionicons name="refresh-outline" size={14} color="#6B7280" />
              <Text style={styles.resetBtnText}>Reset to Defaults</Text>
            </TouchableOpacity>

            {/* Save scores button */}
            {hasScoreChanges && (
              <TouchableOpacity
                onPress={handleSaveScores}
                style={[styles.saveButton, { backgroundColor: themeColor }, savingScores && styles.btnDisabled]}
                disabled={savingScores}
              >
                {savingScores ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Scores & Alerts</Text>
                )}
              </TouchableOpacity>
            )}
            {showSavedMessage && (
              <Text style={styles.savedMessage}>
                Saved! Scores are recomputing in the background — this may take a few minutes for large groups.
              </Text>
            )}
          </View>
        )}

        {/* ── Section 5: Alerts ── */}
        {renderSectionHeader("Alerts", alertsOpen, () => setAlertsOpen((p) => !p))}
        {alertsOpen && (
          <View style={styles.sectionBody}>
            <Text style={styles.hintText}>
              Flag members when a variable exceeds a threshold.
            </Text>

            {alerts.map((alert, index) => {
              const varInfo = variableMap.get(alert.variableId);
              return (
                <View key={alert.id} style={styles.alertCard}>
                  {/* Variable picker */}
                  {alertVariablePickerIndex === index ? (
                    renderAlertVariablePicker(
                      (variableId) => handleAlertVariableChange(index, variableId),
                      () => setAlertVariablePickerIndex(null),
                    )
                  ) : (
                    <Pressable
                      style={styles.alertVariablePicker}
                      onPress={() => setAlertVariablePickerIndex(index)}
                    >
                      <Text style={styles.alertVariableText} numberOfLines={1}>
                        {varInfo?.label ?? alert.variableId}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color="#6B7280" />
                    </Pressable>
                  )}

                  {/* Controls row */}
                  <View style={styles.alertControlsRow}>
                    {/* Direction toggle */}
                    <View style={styles.alertDirectionToggle}>
                      <Pressable
                        style={[
                          styles.alertDirectionBtn,
                          alert.operator === "above" && { backgroundColor: themeColor },
                        ]}
                        onPress={() => alert.operator !== "above" && handleAlertOperatorToggle(index)}
                      >
                        <Text
                          style={[
                            styles.alertDirectionText,
                            alert.operator === "above" && styles.alertDirectionTextActive,
                          ]}
                        >
                          Above
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.alertDirectionBtn,
                          alert.operator === "below" && { backgroundColor: themeColor },
                        ]}
                        onPress={() => alert.operator !== "below" && handleAlertOperatorToggle(index)}
                      >
                        <Text
                          style={[
                            styles.alertDirectionText,
                            alert.operator === "below" && styles.alertDirectionTextActive,
                          ]}
                        >
                          Below
                        </Text>
                      </Pressable>
                    </View>

                    {/* Threshold */}
                    <TextInput
                      style={[
                        styles.alertThresholdInput,
                        Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                      ]}
                      value={alert.threshold === 0 ? "" : String(alert.threshold)}
                      onChangeText={(text) => handleAlertThresholdChange(index, text)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#D1D5DB"
                    />

                    {/* Delete */}
                    <TouchableOpacity style={styles.alertDeleteBtn} onPress={() => handleRemoveAlert(index)}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>

                  {/* Label input */}
                  <TextInput
                    style={[
                      styles.alertLabelInput,
                      Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                    ]}
                    value={alert.label ?? ""}
                    onChangeText={(text) => handleAlertLabelChange(index, text)}
                    placeholder={`${varInfo?.label ?? alert.variableId} ${alert.operator === "above" ? "high" : "low"}`}
                    placeholderTextColor="#D1D5DB"
                    maxLength={30}
                  />
                </View>
              );
            })}

            <TouchableOpacity style={styles.addAlertBtn} onPress={handleAddAlert}>
              <Ionicons name="add-circle-outline" size={14} color={themeColor} />
              <Text style={[styles.addAlertBtnText, { color: themeColor }]}>Add Alert</Text>
            </TouchableOpacity>

            <Text style={styles.hintText}>
              Alerts save together with Scores. Use the Save button in the Scores section.
            </Text>
          </View>
        )}

        {/* ── Section 6: Member Card Subtitle ── */}
        {renderSectionHeader(
          "Member Card Subtitle",
          subtitleOpen,
          () => setSubtitleOpen((p) => !p),
          <Text style={styles.sectionHeaderExtra}>(Mobile only)</Text>,
        )}
        {subtitleOpen && (
          <View style={styles.sectionBody}>
            <Text style={styles.hintText}>
              Choose up to 2 items to show below each member's name.
            </Text>
            <View style={styles.subtitleOptions}>
              {SUBTITLE_VARIABLES.map((v) => {
                const selected = subtitleVars.includes(v.id);
                const disabled = !selected && subtitleVars.length >= 2;
                return (
                  <Pressable
                    key={v.id}
                    style={[
                      styles.subtitleOption,
                      selected && { borderColor: themeColor, backgroundColor: `${themeColor}10` },
                      disabled && { opacity: 0.4 },
                    ]}
                    disabled={disabled}
                    onPress={() => handleSubtitleToggle(v.id)}
                  >
                    <View style={styles.subtitleCheckboxRow}>
                      <View
                        style={[
                          styles.subtitleCheckbox,
                          selected && { backgroundColor: themeColor, borderColor: themeColor },
                        ]}
                      >
                        {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                      <Text
                        style={[
                          styles.subtitleOptionText,
                          selected && { color: themeColor, fontWeight: "600" as const },
                        ]}
                      >
                        {v.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {subtitleVars.length >= 2 && (
              <Text style={styles.hintText}>Maximum of 2 selected</Text>
            )}
            <Text style={[styles.hintText, { marginTop: 8 }]}>
              Subtitle saves together with Scores. Use the Save button in the Scores section.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#111827",
  },
  closeButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    gap: 6,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
  },
  sectionHeaderExtra: {
    fontSize: 10,
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },

  // Text inputs
  textInput: {
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: "#374151",
    backgroundColor: "#F9FAFB",
  },
  hintText: {
    fontSize: 11,
    color: "#9CA3AF",
    lineHeight: 15,
  },

  // Column section
  columnList: {
    gap: 0,
  },
  columnRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  columnArrows: {
    flexDirection: "row",
    gap: 1,
    marginRight: 6,
  },
  arrowBtn: {
    padding: 2,
  },
  columnLabel: {
    flex: 1,
    fontSize: 12,
    color: "#374151",
  },
  columnLabelHidden: {
    color: "#D1D5DB",
    textDecorationLine: "line-through",
  },
  eyeBtn: {
    padding: 3,
  },

  // Subsection
  subsectionDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  subsectionTitle: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Capacity
  capacityRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  capacityBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  capacityText: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "500" as const,
  },

  // Custom field rows
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    gap: 6,
  },
  fieldInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fieldName: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "500" as const,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: "#E5E7EB",
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "600" as const,
    color: "#6B7280",
  },
  fieldOptions: {
    fontSize: 10,
    color: "#9CA3AF",
    flex: 1,
  },
  deleteBtn: {
    padding: 3,
  },

  // Add field form
  addFieldForm: {
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  fieldInput: {
    fontSize: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#fff",
    color: "#374151",
  },
  typePickerRow: {
    flexDirection: "row",
    gap: 4,
    flexWrap: "wrap",
  },
  typeOption: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  typeOptionDisabled: {
    opacity: 0.4,
  },
  typeOptionText: {
    fontSize: 11,
    color: "#374151",
  },
  typeOptionTextDisabled: {
    color: "#9CA3AF",
  },

  // Dropdown options editor
  optionsEditor: {
    gap: 4,
  },
  optionsLabel: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "500" as const,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  optionInput: {
    flex: 1,
    fontSize: 11,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: "#fff",
    color: "#374151",
  },
  optionDeleteBtn: {
    padding: 2,
  },
  addOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
  },
  addOptionText: {
    fontSize: 11,
  },

  // Add field actions
  addFieldActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  cancelFieldBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  cancelFieldText: {
    fontSize: 12,
    color: "#6B7280",
  },
  confirmFieldBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  confirmFieldText: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "600" as const,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Add field button
  addFieldButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
  },
  addFieldButtonText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },

  // Save button
  saveButton: {
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 4,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
  },
  refreshButtonBusy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hintError: {
    fontSize: 11,
    color: "#B91C1C",
    lineHeight: 15,
  },
  savedMessage: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 8,
    fontStyle: "italic" as const,
  },

  // Scores section
  scoreCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  scoreNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreIndexLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#6B7280",
  },
  scoreNameInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 5,
    paddingHorizontal: 8,
    backgroundColor: "#fff",
  },
  scoreNameInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600" as const,
    paddingVertical: 5,
    color: "#374151",
  },
  charCount: {
    fontSize: 10,
    color: "#9CA3AF",
  },
  removeScoreBtn: {
    padding: 4,
  },

  // Variable rows
  variableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  variableInfo: {
    flex: 1,
    minWidth: 0,
  },
  variableLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "#374151",
  },
  variableDesc: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 1,
  },
  weightControl: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 6,
    paddingHorizontal: 2,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  weightBtn: {
    padding: 4,
  },
  weightValue: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: "#374151",
    minWidth: 16,
    textAlign: "center",
  },
  removeVarBtn: {
    padding: 3,
    marginLeft: 4,
  },

  // Add variable
  addVariableBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 6,
  },
  addVariableBtnText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },

  // Add score
  addScoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D1D5DB",
  },
  addScoreBtnText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },

  // Reset
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
  },
  resetBtnText: {
    fontSize: 12,
    color: "#6B7280",
  },

  // Inline picker (used for variable/alert variable selection)
  inlinePicker: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 6,
    padding: 8,
    maxHeight: 260,
  },
  inlinePickerScroll: {
    flexGrow: 0,
  },
  inlinePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  inlinePickerTitle: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#374151",
  },
  categoryHeader: {
    fontSize: 10,
    fontWeight: "600" as const,
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 3,
  },
  pickerRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  pickerRowDisabled: {
    opacity: 0.35,
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "#374151",
  },
  pickerLabelDisabled: {
    color: "#9CA3AF",
  },
  pickerDesc: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 1,
  },

  // Alerts section
  alertCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  alertVariablePicker: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  alertVariableText: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "#374151",
    flex: 1,
  },
  alertControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  alertDirectionToggle: {
    flexDirection: "row",
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  alertDirectionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#F3F4F6",
  },
  alertDirectionText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#6B7280",
  },
  alertDirectionTextActive: {
    color: "#fff",
  },
  alertThresholdInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: "#374151",
    width: 50,
    textAlign: "center",
    backgroundColor: "#fff",
  },
  alertDeleteBtn: {
    padding: 3,
  },
  alertLabelInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 11,
    color: "#374151",
    backgroundColor: "#fff",
  },

  // Add alert
  addAlertBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  addAlertBtnText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },

  // Subtitle section
  subtitleOptions: {
    gap: 6,
  },
  subtitleOption: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  subtitleCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  subtitleCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  subtitleOptionText: {
    fontSize: 12,
    color: "#374151",
  },
});
