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
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import {
  SUBTITLE_VARIABLES,
  normalizeSubtitleVariableIds,
} from "./followupShared";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { CustomFieldDef } from "./ColumnPickerModal";

// ============================================================================
// Types
// ============================================================================

interface FollowupSettingsPanelProps {
  groupId: string;
  crossGroupMode?: boolean;
  communityId?: string;
  isAdmin?: boolean;
  // Current effective column state from parent
  currentColumnOrder: string[];
  currentHiddenColumns: string[];
  columnLabels: Record<string, string>; // key → display label (from table)
  // Live change callback — parent updates table immediately
  onColumnChange: (columnOrder: string[], hiddenColumns: string[]) => void;
  onClose: () => void;
}

// Alert definition matching backend schema
interface AlertRule {
  id: string;
  variableId: string;
  operator: string;
  threshold: number;
  label?: string;
}

// Variable info for the picker
interface VariableOption {
  id: string;
  label: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const SLOT_CANDIDATES: Record<string, string[]> = {
  text: ["customText1", "customText2", "customText3", "customText4", "customText5"],
  dropdown: ["customText1", "customText2", "customText3", "customText4", "customText5"],
  multiselect: ["customText1", "customText2", "customText3", "customText4", "customText5"],
  number: ["customNum1", "customNum2", "customNum3", "customNum4", "customNum5"],
  boolean: ["customBool1", "customBool2", "customBool3", "customBool4", "customBool5"],
};

const SLOT_CAPACITIES: Record<string, { label: string; total: number; types: string[] }> = {
  text: { label: "Text/Dropdown/Multi", total: 5, types: ["text", "dropdown", "multiselect"] },
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
  { value: "multiselect", label: "Multi-Select" },
] as const;

const SYSTEM_COLUMNS = new Set(["checkbox", "rowNum"]);

function normalizeSelectFieldOptions(options: string[]): string[] {
  return options
    .map((option) => option.trim().replace(/;/g, ""))
    .filter(Boolean);
}

// ============================================================================
// Component
// ============================================================================

// Available variables for alert picker (kept in sync with backend VARIABLE_REGISTRY)
const ALERT_VARIABLES: VariableOption[] = [
  { id: "attendance_pct", label: "Attendance %", description: "Meeting attendance percentage" },
  { id: "consecutive_missed", label: "Consecutive Missed", description: "Consecutive missed meetings" },
  { id: "days_since_last_followup", label: "Days Since Follow-up", description: "Days since any follow-up" },
  { id: "days_since_last_text", label: "Days Since Text", description: "Days since last text" },
  { id: "days_since_last_call", label: "Days Since Call", description: "Days since last call" },
  { id: "days_since_last_in_person", label: "Days Since In-Person", description: "Days since last visit" },
  { id: "attendance_all_groups_pct", label: "All Groups Attendance %", description: "Cross-group attendance" },
  { id: "pco_services_past_2mo", label: "Services (2mo)", description: "PCO services in past 2 months" },
];

export function FollowupSettingsPanel({
  groupId,
  crossGroupMode,
  communityId,
  isAdmin,
  currentColumnOrder,
  currentHiddenColumns,
  columnLabels,
  onColumnChange,
  onClose,
}: FollowupSettingsPanelProps) {
  const { primaryColor } = useCommunityTheme();
  const themeColor = primaryColor || DEFAULT_PRIMARY_COLOR;

  // Accordion state — all collapsed by default
  const [displayNameOpen, setDisplayNameOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);

  // ── Data queries ──

  const config = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    !crossGroupMode && groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    !crossGroupMode && groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  ) as any;

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
  const updateCommunityAlertsMut = useAuthenticatedMutation(
    api.functions.communityPeople.updateCommunityAlerts
  );

  // ── Alert queries ──

  const communityAlerts = useAuthenticatedQuery(
    api.functions.communityPeople.getCommunityAlerts,
    communityId ? { communityId: communityId as Id<"communities"> } : "skip"
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
      if ((result as any)?.success) {
        setRefreshMessage("Refresh started. Scores are updating now.");
      } else {
        setRefreshMessage("Could not start refresh. Please try again.");
      }
    } catch (err) {
      console.error("[refreshFollowupScores] failed:", err);
      setRefreshMessage("Could not start refresh. Please try again.");
    } finally {
      setIsRefreshingScores(false);
    }
  }, [groupId, refreshFollowupScoresMut]);

  // ── Columns state ──

  const columnConfig = config?.followupColumnConfig ?? null;
  const initialCustomFields: CustomFieldDef[] = (columnConfig?.customFields ?? []) as CustomFieldDef[];

  // Use props directly for column order and visibility (single source of truth is parent)
  const hiddenColumnsSet = useMemo(() => new Set(currentHiddenColumns), [currentHiddenColumns]);
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "boolean" | "dropdown" | "multiselect">("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [isSavingColumns, setIsSavingColumns] = useState(false);

  // Initialize custom fields from config (only internal state that matters)
  const [customFieldsInitialized, setCustomFieldsInitialized] = useState(false);
  useEffect(() => {
    if (customFieldsInitialized || initialCustomFields.length === 0) return;
    setCustomFieldsInitialized(true);
    setCustomFields(
      initialCustomFields.map((field) => ({
        ...field,
        ...(field.options ? { options: [...field.options] } : {}),
      }))
    );
  }, [initialCustomFields, customFieldsInitialized]);

  const usedSlots = useMemo(
    () => new Set(customFields.map((f) => f.slot)),
    [customFields]
  );

  const labelMap = useMemo(() => {
    const map = new Map(Object.entries(columnLabels));
    // Custom fields added in settings override parent labels
    for (const f of customFields) {
      map.set(f.slot, f.name);
    }
    return map;
  }, [columnLabels, customFields]);

  const moveColumn = useCallback((idx: number, direction: -1 | 1) => {
    const newOrder = [...currentColumnOrder];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    onColumnChange(newOrder, currentHiddenColumns);
  }, [currentColumnOrder, currentHiddenColumns, onColumnChange]);

  const toggleVisibility = useCallback((key: string) => {
    const nextHidden = new Set(currentHiddenColumns);
    if (nextHidden.has(key)) nextHidden.delete(key);
    else nextHidden.add(key);
    onColumnChange(currentColumnOrder, [...nextHidden]);
  }, [currentColumnOrder, currentHiddenColumns, onColumnChange]);

  const handleAddField = useCallback(() => {
    if (!newFieldName.trim()) {
      Alert.alert("Missing name", "Enter a field name before adding.");
      return;
    }
    const slot = getNextAvailableSlot(newFieldType, usedSlots);
    if (!slot) {
      Alert.alert("No slots available", "No available slots for this field type.");
      return;
    }
    const isSelectType = newFieldType === "dropdown" || newFieldType === "multiselect";
    const normalizedOptions = normalizeSelectFieldOptions(newFieldOptions);
    if (isSelectType && normalizedOptions.length === 0) {
      Alert.alert("Missing options", "Add at least one option for dropdown or multi-select.");
      return;
    }

    const newField: CustomFieldDef = {
      slot,
      name: newFieldName.trim(),
      type: newFieldType,
      ...(isSelectType
        ? { options: normalizedOptions }
        : {}),
    };

    setCustomFields((prev) => [...prev, newField]);
    const newOrder = currentColumnOrder.includes(slot)
      ? currentColumnOrder
      : [...currentColumnOrder, slot];
    onColumnChange(newOrder, currentHiddenColumns);
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldOptions([]);
    setShowAddField(false);
  }, [newFieldName, newFieldType, newFieldOptions, usedSlots, currentColumnOrder, currentHiddenColumns, onColumnChange]);

  const handleDeleteField = useCallback((idx: number) => {
    setCustomFields((prev) => {
      const field = prev[idx];
      const newOrder = currentColumnOrder.filter((k) => k !== field.slot);
      const newHidden = currentHiddenColumns.filter((k) => k !== field.slot);
      onColumnChange(newOrder, newHidden);
      return prev.filter((_, i) => i !== idx);
    });
  }, [currentColumnOrder, currentHiddenColumns, onColumnChange]);

  const canAddType = useCallback(
    (type: string): boolean => getNextAvailableSlot(type, usedSlots) !== null,
    [usedSlots]
  );
  const isNewFieldSelectType = newFieldType === "dropdown" || newFieldType === "multiselect";
  const normalizedNewFieldOptions = useMemo(
    () => normalizeSelectFieldOptions(newFieldOptions),
    [newFieldOptions]
  );
  const canSubmitNewField = useMemo(
    () =>
      !!newFieldName.trim()
      && canAddType(newFieldType)
      && (!isNewFieldSelectType || normalizedNewFieldOptions.length > 0),
    [newFieldName, canAddType, newFieldType, isNewFieldSelectType, normalizedNewFieldOptions]
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

  // Save custom fields only (structural change, group-level)
  const handleSaveCustomFields = useCallback(async () => {
    if (crossGroupMode) return;
    if (showAddField) {
      Alert.alert("Finish adding field", "Click Add Field or Cancel before saving.");
      return;
    }
    setIsSavingColumns(true);
    try {
      await saveColumnConfigMut({
        groupId: groupId as Id<"groups">,
        followupColumnConfig: {
          columnOrder: currentColumnOrder,
          hiddenColumns: currentHiddenColumns,
          customFields,
        },
      });
      Alert.alert("Custom fields saved", "Custom field changes were saved.");
    } catch (err) {
      console.error("[saveFollowupColumnConfig] failed:", err);
      Alert.alert(
        "Could not save",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setIsSavingColumns(false);
    }
  }, [
    crossGroupMode,
    groupId,
    currentColumnOrder,
    currentHiddenColumns,
    customFields,
    saveColumnConfigMut,
    showAddField,
  ]);

  // ── Subtitle state ──

  const [subtitleVars, setSubtitleVars] = useState<string[]>([]);
  const [hasSubtitleChanges, setHasSubtitleChanges] = useState(false);
  const [savingSubtitle, setSavingSubtitle] = useState(false);

  // Initialize subtitle from group data
  useEffect(() => {
    const savedSubtitle = groupData?.followupScoreConfig?.memberSubtitle ?? "";
    setSubtitleVars(normalizeSubtitleVariableIds(savedSubtitle));
  }, [groupData?.followupScoreConfig]);

  const handleSubtitleToggle = useCallback((varId: string) => {
    setSubtitleVars((prev) => {
      if (prev.includes(varId)) {
        return prev.filter((id) => id !== varId);
      }
      if (prev.length >= 2) return prev;
      return [...prev, varId];
    });
    setHasSubtitleChanges(true);
  }, []);

  const handleSaveSubtitle = useCallback(async () => {
    setSavingSubtitle(true);
    try {
      await updateScoreConfig({
        groupId: groupId as Id<"groups">,
        followupScoreConfig: subtitleVars.length > 0
          ? { scores: groupData?.followupScoreConfig?.scores ?? [], memberSubtitle: subtitleVars.join(",") }
          : undefined,
      });
      setHasSubtitleChanges(false);
    } catch (err) {
      console.error("[updateFollowupScoreConfig] failed:", err);
    } finally {
      setSavingSubtitle(false);
    }
  }, [groupId, subtitleVars, groupData?.followupScoreConfig?.scores, updateScoreConfig]);

  // ── Alerts state ──

  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertsInitialized, setAlertsInitialized] = useState(false);
  const [showAddAlert, setShowAddAlert] = useState(false);
  const [newAlertVariable, setNewAlertVariable] = useState(ALERT_VARIABLES[0].id);
  const [newAlertOperator, setNewAlertOperator] = useState<"above" | "below">("above");
  const [newAlertThreshold, setNewAlertThreshold] = useState("");
  const [newAlertLabel, setNewAlertLabel] = useState("");
  const [isSavingAlerts, setIsSavingAlerts] = useState(false);
  const [hasAlertChanges, setHasAlertChanges] = useState(false);

  // Initialize alerts from community data
  useEffect(() => {
    if (alertsInitialized || !communityAlerts) return;
    setAlertsInitialized(true);
    setAlertRules(communityAlerts as AlertRule[]);
  }, [communityAlerts, alertsInitialized]);

  const handleAddAlert = useCallback(() => {
    const threshold = parseFloat(newAlertThreshold);
    if (isNaN(threshold)) {
      Alert.alert("Invalid threshold", "Enter a valid number for the threshold.");
      return;
    }

    const newAlert: AlertRule = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      variableId: newAlertVariable,
      operator: newAlertOperator,
      threshold,
      label: newAlertLabel.trim() || undefined,
    };

    setAlertRules((prev) => [...prev, newAlert]);
    setHasAlertChanges(true);
    setNewAlertVariable(ALERT_VARIABLES[0].id);
    setNewAlertOperator("above");
    setNewAlertThreshold("");
    setNewAlertLabel("");
    setShowAddAlert(false);
  }, [newAlertVariable, newAlertOperator, newAlertThreshold, newAlertLabel]);

  const handleDeleteAlert = useCallback((id: string) => {
    setAlertRules((prev) => prev.filter((a) => a.id !== id));
    setHasAlertChanges(true);
  }, []);

  const handleSaveAlerts = useCallback(async () => {
    if (!communityId) return;
    setIsSavingAlerts(true);
    try {
      await updateCommunityAlertsMut({
        communityId: communityId as Id<"communities">,
        alerts: alertRules,
      });
      setHasAlertChanges(false);
      Alert.alert("Alerts saved", "Alert rules have been saved. Refresh scores to apply.");
    } catch (err) {
      console.error("[updateCommunityAlerts] failed:", err);
      Alert.alert(
        "Could not save",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setIsSavingAlerts(false);
    }
  }, [communityId, alertRules, updateCommunityAlertsMut]);

  // ── Loading ──

  if (!crossGroupMode && (!config || !groupData)) {
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
        {/* ── Section 1: Display Name (hidden in cross-group mode) ── */}
        {!crossGroupMode && renderSectionHeader("Display Name", displayNameOpen, () => setDisplayNameOpen((p) => !p))}
        {!crossGroupMode && displayNameOpen && (
          <View style={styles.sectionBody}>
            <TextInput
              style={[
                styles.textInput,
                Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
              ]}
              value={toolDisplayName}
              onChangeText={setToolDisplayName}
              onBlur={handleDisplayNameBlur}
              placeholder="People"
              placeholderTextColor="#9CA3AF"
              maxLength={20}
            />
            <Text style={styles.hintText}>
              Customize what this tool is called. Leave empty for default.
            </Text>
          </View>
        )}

        {/* ── Section 2: Data (hidden in cross-group mode) ── */}
        {!crossGroupMode && renderSectionHeader("Data", dataOpen, () => setDataOpen((p) => !p))}
        {!crossGroupMode && dataOpen && (
          <View style={styles.sectionBody}>
            <TouchableOpacity
              onPress={handleRefreshFollowupScores}
              style={[
                styles.saveButton,
                { backgroundColor: themeColor },
                isRefreshingScores && styles.btnDisabled,
              ]}
              disabled={isRefreshingScores}
            >
              {isRefreshingScores ? (
                <View style={styles.refreshButtonBusy}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.saveButtonText}>Starting Refresh...</Text>
                </View>
              ) : (
                <Text style={styles.saveButtonText}>Refresh People Table Now</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.hintText}>
              Recalculates all scores for this community.
            </Text>
            {refreshMessage && <Text style={styles.hintText}>{refreshMessage}</Text>}
          </View>
        )}

        {/* ── Section 3: Columns ── */}
        {renderSectionHeader("Columns", columnsOpen, () => setColumnsOpen((p) => !p))}
        {columnsOpen && (
          <View style={styles.sectionBody}>
            {/* Column order & visibility */}
            <View style={styles.columnList}>
              {currentColumnOrder.map((key, idx) => {
                const label = labelMap.get(key) ?? key;
                const isHidden = hiddenColumnsSet.has(key);
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
                        disabled={idx === currentColumnOrder.length - 1}
                        style={styles.arrowBtn}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={14}
                          color={idx === currentColumnOrder.length - 1 ? "#D1D5DB" : "#6B7280"}
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

            {/* Custom Fields subsection (hidden in cross-group mode) */}
            {!crossGroupMode && (
              <>
                <View style={styles.subsectionDivider} />
                <Text style={styles.subsectionTitle}>Custom Fields</Text>
                <Text style={styles.noteText}>
                  Custom fields are shared across all groups in your community.
                </Text>

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
                      {(field.type === "dropdown" || field.type === "multiselect") && field.options && (
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

                    {/* Dropdown / multiselect options editor */}
                    {(newFieldType === "dropdown" || newFieldType === "multiselect") && (
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
                                next[i] = text.replace(/;/g, "");
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
                          !canSubmitNewField && styles.btnDisabled,
                        ]}
                        disabled={!canSubmitNewField}
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
              </>
            )}

            {/* Save custom fields button (only when custom fields exist or were modified) */}
            {!crossGroupMode && customFields.length > 0 && (
              <TouchableOpacity
                onPress={handleSaveCustomFields}
                style={[
                  styles.saveButton,
                  { backgroundColor: themeColor },
                  (isSavingColumns || showAddField) && styles.btnDisabled,
                ]}
                disabled={isSavingColumns || showAddField}
              >
                {isSavingColumns ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Custom Fields</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Hint text about live preview */}
            <Text style={styles.hintText}>
              Changes preview live. Save as a view to keep them.
            </Text>
          </View>
        )}

        {/* ── Section 4: Member Card Subtitle (hidden in cross-group mode) ── */}
        {!crossGroupMode && renderSectionHeader(
          "Member Card Subtitle",
          subtitleOpen,
          () => setSubtitleOpen((p) => !p),
          <Text style={styles.sectionHeaderExtra}>(Mobile only)</Text>,
        )}
        {!crossGroupMode && subtitleOpen && (
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
            {hasSubtitleChanges && (
              <TouchableOpacity
                onPress={handleSaveSubtitle}
                style={[styles.saveButton, { backgroundColor: themeColor }, savingSubtitle && styles.btnDisabled]}
                disabled={savingSubtitle}
              >
                {savingSubtitle ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Subtitle</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
        {/* ── Section 5: Scores (read-only, all users) ── */}
        {renderSectionHeader("Scores", scoresOpen, () => setScoresOpen((p) => !p))}
        {scoresOpen && (
          <View style={styles.sectionBody}>
            <View style={styles.scoreExplainer}>
              <Text style={styles.scoreExplainerTitle}>Service (Score 1)</Text>
              <Text style={styles.scoreExplainerText}>
                Measures PCO serving engagement over the past 2 months. Each service adds 20 points (max 100 at 5+ services).
              </Text>
            </View>
            <View style={styles.scoreExplainer}>
              <Text style={styles.scoreExplainerTitle}>Attendance (Score 2)</Text>
              <Text style={styles.scoreExplainerText}>
                Percentage of meetings attended across all groups in the community. Shows as a direct 0-100% score.
              </Text>
            </View>
            <View style={styles.scoreExplainer}>
              <Text style={styles.scoreExplainerTitle}>Togather (Score 3)</Text>
              <Text style={styles.scoreExplainerText}>
                Composite engagement score combining attendance consistency and followup recency. Attendance starts at 100 and drops 15 points per consecutive miss. Followup score is based on the most recent contact: in-person (100), call (85), or text (70), decaying by 1 point per day. The two components are averaged.
              </Text>
            </View>
            <View style={styles.subsectionDivider} />
            <View style={styles.colorLegendRow}>
              <View style={[styles.colorDot, { backgroundColor: "#22C55E" }]} />
              <Text style={styles.colorLegendText}>Green: 70+</Text>
              <View style={[styles.colorDot, { backgroundColor: "#F59E0B" }]} />
              <Text style={styles.colorLegendText}>Orange: 40-69</Text>
              <View style={[styles.colorDot, { backgroundColor: "#EF4444" }]} />
              <Text style={styles.colorLegendText}>Red: &lt;40</Text>
            </View>
          </View>
        )}

        {/* ── Section 6: Alerts (admin-only) ── */}
        {isAdmin && communityId && renderSectionHeader("Alerts", alertsOpen, () => setAlertsOpen((p) => !p))}
        {isAdmin && communityId && alertsOpen && (
          <View style={styles.sectionBody}>
            <Text style={styles.hintText}>
              Custom alert rules trigger when a member's metric crosses a threshold.
              Alerts appear in the Alerts column of the people table.
            </Text>

            {/* Existing alert rules */}
            {alertRules.map((alert) => {
              const varDef = ALERT_VARIABLES.find((v) => v.id === alert.variableId);
              return (
                <View key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertCardInfo}>
                    <Text style={styles.alertCardLabel}>
                      {alert.label || `${varDef?.label ?? alert.variableId} ${alert.operator} ${alert.threshold}`}
                    </Text>
                    <Text style={styles.alertCardDetail}>
                      {varDef?.label ?? alert.variableId} {alert.operator} {alert.threshold}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteAlert(alert.id)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* Add alert form */}
            {showAddAlert ? (
              <View style={styles.addFieldForm}>
                <Text style={styles.optionsLabel}>Variable</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.alertPickerScroll}
                >
                  <View style={styles.typePickerRow}>
                    {ALERT_VARIABLES.map((v) => (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.typeOption,
                          newAlertVariable === v.id && {
                            borderColor: themeColor,
                            backgroundColor: `${themeColor}10`,
                          },
                        ]}
                        onPress={() => setNewAlertVariable(v.id)}
                      >
                        <Text
                          style={[
                            styles.typeOptionText,
                            newAlertVariable === v.id && {
                              color: themeColor,
                              fontWeight: "600" as const,
                            },
                          ]}
                        >
                          {v.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.optionsLabel}>Condition</Text>
                <View style={styles.typePickerRow}>
                  <TouchableOpacity
                    style={[
                      styles.typeOption,
                      newAlertOperator === "above" && {
                        borderColor: themeColor,
                        backgroundColor: `${themeColor}10`,
                      },
                    ]}
                    onPress={() => setNewAlertOperator("above")}
                  >
                    <Text
                      style={[
                        styles.typeOptionText,
                        newAlertOperator === "above" && {
                          color: themeColor,
                          fontWeight: "600" as const,
                        },
                      ]}
                    >
                      Above
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeOption,
                      newAlertOperator === "below" && {
                        borderColor: themeColor,
                        backgroundColor: `${themeColor}10`,
                      },
                    ]}
                    onPress={() => setNewAlertOperator("below")}
                  >
                    <Text
                      style={[
                        styles.typeOptionText,
                        newAlertOperator === "below" && {
                          color: themeColor,
                          fontWeight: "600" as const,
                        },
                      ]}
                    >
                      Below
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.optionsLabel}>Threshold</Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newAlertThreshold}
                  onChangeText={setNewAlertThreshold}
                  placeholder="e.g. 3"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                />

                <Text style={styles.optionsLabel}>Label (optional)</Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newAlertLabel}
                  onChangeText={setNewAlertLabel}
                  placeholder="e.g. High miss count"
                  placeholderTextColor="#9CA3AF"
                />

                <View style={styles.addFieldActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAddAlert(false);
                      setNewAlertThreshold("");
                      setNewAlertLabel("");
                    }}
                    style={styles.cancelFieldBtn}
                  >
                    <Text style={styles.cancelFieldText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAddAlert}
                    style={[
                      styles.confirmFieldBtn,
                      { backgroundColor: themeColor },
                      !newAlertThreshold.trim() && styles.btnDisabled,
                    ]}
                    disabled={!newAlertThreshold.trim()}
                  >
                    <Text style={styles.confirmFieldText}>Add Alert</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowAddAlert(true)} style={styles.addFieldButton}>
                <Ionicons name="add-circle-outline" size={16} color={themeColor} />
                <Text style={[styles.addFieldButtonText, { color: themeColor }]}>Add Alert Rule</Text>
              </TouchableOpacity>
            )}

            {/* Save alerts button */}
            {hasAlertChanges && (
              <TouchableOpacity
                onPress={handleSaveAlerts}
                style={[
                  styles.saveButton,
                  { backgroundColor: themeColor },
                  isSavingAlerts && styles.btnDisabled,
                ]}
                disabled={isSavingAlerts}
              >
                {isSavingAlerts ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Alerts</Text>
                )}
              </TouchableOpacity>
            )}
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
  noteText: {
    fontSize: 11,
    color: "#6B7280",
    fontStyle: "italic" as const,
    lineHeight: 15,
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

  // Score explanation section
  scoreExplainer: {
    gap: 2,
  },
  scoreExplainerTitle: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#374151",
  },
  scoreExplainerText: {
    fontSize: 11,
    color: "#6B7280",
    lineHeight: 16,
  },
  colorLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  colorLegendText: {
    fontSize: 11,
    color: "#6B7280",
    marginRight: 6,
  },

  // Alert section
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  alertCardInfo: {
    flex: 1,
    gap: 1,
  },
  alertCardLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "#374151",
  },
  alertCardDetail: {
    fontSize: 10,
    color: "#9CA3AF",
  },
  alertPickerScroll: {
    maxHeight: 36,
  },
});
