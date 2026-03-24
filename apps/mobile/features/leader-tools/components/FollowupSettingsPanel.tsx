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
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Types
// ============================================================================

interface FollowupSettingsPanelProps {
  groupId: string;
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

// Available variables for alert picker (must match SystemRawValues keys used at evaluation time)
const ALERT_VARIABLES: VariableOption[] = [
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
  communityId,
  isAdmin,
  currentColumnOrder,
  currentHiddenColumns,
  columnLabels,
  onColumnChange,
  onClose,
}: FollowupSettingsPanelProps) {
  const { colors } = useTheme();
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
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
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

  if (!config || !groupData) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
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
    <TouchableOpacity style={[styles.sectionHeader, { borderBottomColor: colors.borderLight }]} onPress={onToggle} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? "chevron-down" : "chevron-forward"}
        size={14}
        color={colors.iconSecondary}
      />
      <Text style={[styles.sectionHeaderText, { color: colors.textTertiary }]}>{title}</Text>
      {extra}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {/* ── Section 1: Display Name ── */}
        {renderSectionHeader("Display Name", displayNameOpen, () => setDisplayNameOpen((p) => !p))}
        {displayNameOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
            <TextInput
              style={[
                styles.textInput,
                { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground },
                Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
              ]}
              value={toolDisplayName}
              onChangeText={setToolDisplayName}
              onBlur={handleDisplayNameBlur}
              placeholder="People"
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={20}
            />
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
              Customize what this tool is called. Leave empty for default.
            </Text>
          </View>
        )}

        {/* ── Section 2: Data ── */}
        {renderSectionHeader("Data", dataOpen, () => setDataOpen((p) => !p))}
        {dataOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={[styles.saveButtonText, { color: '#fff' }]}>Starting Refresh...</Text>
                </View>
              ) : (
                <Text style={[styles.saveButtonText, { color: '#fff' }]}>Refresh People Table Now</Text>
              )}
            </TouchableOpacity>
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
              Recalculates all scores for this community.
            </Text>
            {refreshMessage && <Text style={[styles.hintText, { color: colors.textTertiary }]}>{refreshMessage}</Text>}
          </View>
        )}

        {/* ── Section 3: Columns ── */}
        {renderSectionHeader("Columns", columnsOpen, () => setColumnsOpen((p) => !p))}
        {columnsOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
            {/* Column order & visibility */}
            <View style={styles.columnList}>
              {currentColumnOrder.map((key, idx) => {
                const label = labelMap.get(key) ?? key;
                const isHidden = hiddenColumnsSet.has(key);
                return (
                  <View key={key} style={[styles.columnRow, { borderBottomColor: colors.borderLight }]}>
                    <View style={styles.columnArrows}>
                      <TouchableOpacity
                        onPress={() => moveColumn(idx, -1)}
                        disabled={idx === 0}
                        style={styles.arrowBtn}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={14}
                          color={idx === 0 ? colors.buttonDisabled : colors.icon}
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
                          color={idx === currentColumnOrder.length - 1 ? colors.buttonDisabled : colors.icon}
                        />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.columnLabel, { color: colors.textSecondary }, isHidden && { color: colors.border, textDecorationLine: 'line-through' }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <TouchableOpacity onPress={() => toggleVisibility(key)} style={styles.eyeBtn}>
                      <Ionicons
                        name={isHidden ? "eye-off-outline" : "eye-outline"}
                        size={16}
                        color={isHidden ? colors.buttonDisabled : colors.icon}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Custom Fields subsection */}
            <View style={[styles.subsectionDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.subsectionTitle, { color: colors.textTertiary }]}>Custom Fields</Text>
            <Text style={[styles.noteText, { color: colors.textTertiary }]}>
              Custom fields are shared across all groups in your community.
            </Text>

            {/* Capacity indicators */}
            <View style={styles.capacityRow}>
              {Object.entries(SLOT_CAPACITIES).map(([key, info]) => (
                <View key={key} style={[styles.capacityBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.capacityText, { color: colors.textTertiary }]}>
                    {info.label}: {capacityInfo[key] ?? 0}/{info.total}
                  </Text>
                </View>
              ))}
            </View>

            {/* Existing custom fields */}
            {customFields.map((field, idx) => (
              <View key={field.slot} style={[styles.fieldRow, { backgroundColor: colors.surfaceSecondary }]}>
                <View style={styles.fieldInfo}>
                  <Text style={[styles.fieldName, { color: colors.textSecondary }]}>{field.name}</Text>
                  <View style={[styles.typeBadge, { backgroundColor: colors.border }]}>
                    <Text style={[styles.typeBadgeText, { color: colors.textTertiary }]}>{field.type}</Text>
                  </View>
                  {(field.type === "dropdown" || field.type === "multiselect") && field.options && (
                    <Text style={[styles.fieldOptions, { color: colors.textTertiary }]} numberOfLines={1}>
                      ({field.options.join(", ")})
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => handleDeleteField(idx)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={14} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ))}

            {/* Add custom field form */}
            {showAddField ? (
              <View style={[styles.addFieldForm, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <TextInput
                  style={[
                    styles.fieldInput,
                    { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground },
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newFieldName}
                  onChangeText={setNewFieldName}
                  placeholder="Field name..."
                  placeholderTextColor={colors.inputPlaceholder}
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
                          { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                          isActive && { borderColor: themeColor, backgroundColor: `${themeColor}10` },
                          !enabled && styles.typeOptionDisabled,
                        ]}
                        onPress={() => enabled && setNewFieldType(ft.value)}
                        disabled={!enabled}
                      >
                        <Text
                          style={[
                            styles.typeOptionText,
                            { color: colors.textSecondary },
                            isActive && { color: themeColor, fontWeight: "600" as const },
                            !enabled && { color: colors.textTertiary },
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
                    <Text style={[styles.optionsLabel, { color: colors.textTertiary }]}>Options:</Text>
                    {newFieldOptions.map((opt, i) => (
                      <View key={i} style={styles.optionRow}>
                        <TextInput
                          style={[
                            styles.optionInput,
                            { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground },
                            Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                          ]}
                          value={opt}
                          onChangeText={(text) => {
                            const next = [...newFieldOptions];
                            next[i] = text.replace(/;/g, "");
                            setNewFieldOptions(next);
                          }}
                          placeholder={`Option ${i + 1}`}
                          placeholderTextColor={colors.inputPlaceholder}
                        />
                        <TouchableOpacity
                          onPress={() => setNewFieldOptions(newFieldOptions.filter((_, j) => j !== i))}
                          style={styles.optionDeleteBtn}
                        >
                          <Ionicons name="close-circle" size={16} color={colors.iconSecondary} />
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
                    <Text style={[styles.cancelFieldText, { color: colors.textTertiary }]}>Cancel</Text>
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
                    <Text style={[styles.confirmFieldText, { color: '#fff' }]}>Add Field</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowAddField(true)} style={styles.addFieldButton}>
                <Ionicons name="add-circle-outline" size={16} color={themeColor} />
                <Text style={[styles.addFieldButtonText, { color: themeColor }]}>Add Custom Field</Text>
              </TouchableOpacity>
            )}

            {/* Save custom fields button (only when custom fields exist or were modified) */}
            {customFields.length > 0 && (
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.saveButtonText, { color: '#fff' }]}>Save Custom Fields</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Hint text about live preview */}
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
              Changes preview live. Save as a view to keep them.
            </Text>
          </View>
        )}

        {/* ── Section 4: Member Card Subtitle ── */}
        {renderSectionHeader(
          "Member Card Subtitle",
          subtitleOpen,
          () => setSubtitleOpen((p) => !p),
          <Text style={[styles.sectionHeaderExtra, { color: colors.textTertiary }]}>(Mobile only)</Text>,
        )}
        {subtitleOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
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
                      { borderColor: colors.border },
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
                          { borderColor: colors.inputBorder },
                          selected && { backgroundColor: themeColor, borderColor: themeColor },
                        ]}
                      >
                        {selected && <Ionicons name="checkmark" size={12} color={colors.textInverse} />}
                      </View>
                      <Text
                        style={[
                          styles.subtitleOptionText,
                          { color: colors.textSecondary },
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
              <Text style={[styles.hintText, { color: colors.textTertiary }]}>Maximum of 2 selected</Text>
            )}
            {hasSubtitleChanges && (
              <TouchableOpacity
                onPress={handleSaveSubtitle}
                style={[styles.saveButton, { backgroundColor: themeColor }, savingSubtitle && styles.btnDisabled]}
                disabled={savingSubtitle}
              >
                {savingSubtitle ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.saveButtonText, { color: '#fff' }]}>Save Subtitle</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
        {/* ── Section 5: Scores (read-only, all users) ── */}
        {renderSectionHeader("Scores", scoresOpen, () => setScoresOpen((p) => !p))}
        {scoresOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.scoreExplainer}>
              <Text style={[styles.scoreExplainerTitle, { color: colors.textSecondary }]}>Service (Score 1)</Text>
              <Text style={[styles.scoreExplainerText, { color: colors.textTertiary }]}>
                Measures PCO serving engagement over the past 2 months. Each service adds 20 points (max 100 at 5+ services).
              </Text>
            </View>
            <View style={styles.scoreExplainer}>
              <Text style={[styles.scoreExplainerTitle, { color: colors.textSecondary }]}>Attendance (Score 2)</Text>
              <Text style={[styles.scoreExplainerText, { color: colors.textTertiary }]}>
                Percentage of meetings attended across all groups in the community. Shows as a direct 0-100% score.
              </Text>
            </View>
            <View style={styles.scoreExplainer}>
              <Text style={[styles.scoreExplainerTitle, { color: colors.textSecondary }]}>Togather (Score 3)</Text>
              <Text style={[styles.scoreExplainerText, { color: colors.textTertiary }]}>
                Composite engagement score combining attendance consistency and followup recency. Attendance starts at 100 and drops 15 points per consecutive miss. Followup score is based on the most recent contact: in-person (100), call (85), or text (70), decaying by 1 point per day. The two components are averaged.
              </Text>
            </View>
            <View style={[styles.subsectionDivider, { backgroundColor: colors.border }]} />
            <View style={styles.colorLegendRow}>
              <View style={[styles.colorDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.colorLegendText, { color: colors.textTertiary }]}>Green: 70+</Text>
              <View style={[styles.colorDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.colorLegendText, { color: colors.textTertiary }]}>Orange: 40-69</Text>
              <View style={[styles.colorDot, { backgroundColor: colors.destructive }]} />
              <Text style={[styles.colorLegendText, { color: colors.textTertiary }]}>Red: &lt;40</Text>
            </View>
          </View>
        )}

        {/* ── Section 6: Alerts (admin-only) ── */}
        {isAdmin && communityId && renderSectionHeader("Alerts", alertsOpen, () => setAlertsOpen((p) => !p))}
        {isAdmin && communityId && alertsOpen && (
          <View style={[styles.sectionBody, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
              Custom alert rules trigger when a member's metric crosses a threshold.
              Alerts appear in the Alerts column of the people table.
            </Text>

            {/* Existing alert rules */}
            {alertRules.map((alert) => {
              const varDef = ALERT_VARIABLES.find((v) => v.id === alert.variableId);
              return (
                <View key={alert.id} style={[styles.alertCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                  <View style={styles.alertCardInfo}>
                    <Text style={[styles.alertCardLabel, { color: colors.textSecondary }]}>
                      {alert.label || `${varDef?.label ?? alert.variableId} ${alert.operator} ${alert.threshold}`}
                    </Text>
                    <Text style={[styles.alertCardDetail, { color: colors.textTertiary }]}>
                      {varDef?.label ?? alert.variableId} {alert.operator} {alert.threshold}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteAlert(alert.id)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={14} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* Add alert form */}
            {showAddAlert ? (
              <View style={[styles.addFieldForm, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Text style={[styles.optionsLabel, { color: colors.textTertiary }]}>Variable</Text>
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
                          { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
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
                            { color: colors.textSecondary },
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

                <Text style={[styles.optionsLabel, { color: colors.textTertiary }]}>Condition</Text>
                <View style={styles.typePickerRow}>
                  <TouchableOpacity
                    style={[
                      styles.typeOption,
                      { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
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
                        { color: colors.textSecondary },
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
                      { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
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
                        { color: colors.textSecondary },
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

                <Text style={[styles.optionsLabel, { color: colors.textTertiary }]}>Threshold</Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground },
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newAlertThreshold}
                  onChangeText={setNewAlertThreshold}
                  placeholder="e.g. 3"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="numeric"
                />

                <Text style={[styles.optionsLabel, { color: colors.textTertiary }]}>Label (optional)</Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground },
                    Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {},
                  ]}
                  value={newAlertLabel}
                  onChangeText={setNewAlertLabel}
                  placeholder="e.g. High miss count"
                  placeholderTextColor={colors.inputPlaceholder}
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
                    <Text style={[styles.cancelFieldText, { color: colors.textTertiary }]}>Cancel</Text>
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
                    <Text style={[styles.confirmFieldText, { color: '#fff' }]}>Add Alert</Text>
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.saveButtonText, { color: '#fff' }]}>Save Alerts</Text>
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
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
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
    gap: 6,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: "600" as const,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
  },
  sectionHeaderExtra: {
    fontSize: 10,
    fontStyle: "italic",
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
  },

  // Text inputs
  textInput: {
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  hintText: {
    fontSize: 11,
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
  },
  columnLabelHidden: {
    textDecorationLine: "line-through",
  },
  eyeBtn: {
    padding: 3,
  },

  // Subsection
  subsectionDivider: {
    height: 1,
    marginVertical: 4,
  },
  subsectionTitle: {
    fontSize: 11,
    fontWeight: "600" as const,
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
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  capacityText: {
    fontSize: 10,
    fontWeight: "500" as const,
  },

  // Custom field rows
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 6,
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
    fontWeight: "500" as const,
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "600" as const,
  },
  fieldOptions: {
    fontSize: 10,
    flex: 1,
  },
  deleteBtn: {
    padding: 3,
  },

  // Add field form
  addFieldForm: {
    borderRadius: 6,
    padding: 10,
    gap: 8,
    borderWidth: 1,
  },
  fieldInput: {
    fontSize: 12,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
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
  },
  typeOptionDisabled: {
    opacity: 0.4,
  },
  typeOptionText: {
    fontSize: 11,
  },
  typeOptionTextDisabled: {},

  // Dropdown options editor
  optionsEditor: {
    gap: 4,
  },
  optionsLabel: {
    fontSize: 11,
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
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
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
  },
  confirmFieldBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  confirmFieldText: {
    fontSize: 12,
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
    lineHeight: 15,
  },
  noteText: {
    fontSize: 11,
    fontStyle: "italic" as const,
    lineHeight: 15,
  },

  // Subtitle section
  subtitleOptions: {
    gap: 6,
  },
  subtitleOption: {
    borderWidth: 1.5,
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
    alignItems: "center",
    justifyContent: "center",
  },
  subtitleOptionText: {
    fontSize: 12,
  },

  // Score explanation section
  scoreExplainer: {
    gap: 2,
  },
  scoreExplainerTitle: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  scoreExplainerText: {
    fontSize: 11,
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
    marginRight: 6,
  },

  // Alert section
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 6,
    borderWidth: 1,
  },
  alertCardInfo: {
    flex: 1,
    gap: 1,
  },
  alertCardLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  alertCardDetail: {
    fontSize: 10,
  },
  alertPickerScroll: {
    maxHeight: 36,
  },
});
