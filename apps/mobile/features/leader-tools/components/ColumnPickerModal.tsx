import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";
import { useTheme } from "@hooks/useTheme";

// ============================================================================
// Types
// ============================================================================

export type CustomFieldDef = {
  slot: string;
  name: string;
  type: "text" | "number" | "boolean" | "dropdown" | "multiselect";
  options?: string[];
};

export type ColumnPickerConfig = {
  columnOrder: string[];
  hiddenColumns: string[];
  customFields: CustomFieldDef[];
};

interface ColumnPickerModalProps {
  visible: boolean;
  onClose: () => void;
  columns: { key: string; label: string }[];
  columnOrder: string[];
  hiddenColumns: string[];
  customFields: CustomFieldDef[];
  onSave: (config: ColumnPickerConfig) => void;
  isSaving?: boolean;
}

// ============================================================================
// Slot Assignment
// ============================================================================

const SLOT_CANDIDATES: Record<string, string[]> = {
  text: [
    "customText1",
    "customText2",
    "customText3",
    "customText4",
    "customText5",
  ],
  dropdown: [
    "customText1",
    "customText2",
    "customText3",
    "customText4",
    "customText5",
  ],
  multiselect: [
    "customText1",
    "customText2",
    "customText3",
    "customText4",
    "customText5",
  ],
  number: [
    "customNum1",
    "customNum2",
    "customNum3",
    "customNum4",
    "customNum5",
  ],
  boolean: [
    "customBool1",
    "customBool2",
    "customBool3",
    "customBool4",
    "customBool5",
  ],
};

const SLOT_CAPACITIES: Record<
  string,
  { label: string; total: number; types: string[] }
> = {
  text: {
    label: "Text/Dropdown/Multi",
    total: 5,
    types: ["text", "dropdown", "multiselect"],
  },
  number: { label: "Number", total: 5, types: ["number"] },
  boolean: { label: "Checkbox", total: 5, types: ["boolean"] },
};

function getNextAvailableSlot(
  type: string,
  usedSlots: Set<string>,
): string | null {
  return (SLOT_CANDIDATES[type] ?? []).find((s) => !usedSlots.has(s)) ?? null;
}

// System columns that can't be reordered/hidden
const SYSTEM_COLUMNS = new Set(["checkbox", "rowNum"]);

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-Select" },
] as const;

// ============================================================================
// Component
// ============================================================================

export function ColumnPickerModal({
  visible,
  onClose,
  columns,
  columnOrder: initialOrder,
  hiddenColumns: initialHidden,
  customFields: initialCustomFields,
  onSave,
  isSaving = false,
}: ColumnPickerModalProps) {
  const { colors, isDark } = useTheme();
  // Local editing state
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<
    "text" | "number" | "boolean" | "dropdown" | "multiselect"
  >("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [showAddField, setShowAddField] = useState(false);

  // Reset local state when modal opens or when initial values change
  React.useEffect(() => {
    if (visible) {
      // Build the full order from config or default
      const allKeys = columns
        .map((c) => c.key)
        .filter((k) => !SYSTEM_COLUMNS.has(k));
      if (initialOrder.length > 0) {
        // Start with config order, append any new columns at end
        const orderSet = new Set(initialOrder);
        const merged = [...initialOrder.filter((k) => allKeys.includes(k))];
        for (const k of allKeys) {
          if (!orderSet.has(k)) merged.push(k);
        }
        setOrder(merged);
      } else {
        setOrder(allKeys);
      }
      setHidden(new Set(initialHidden));
      setFields([...initialCustomFields]);
      setEditingFieldIdx(null);
      setShowAddField(false);
    }
  }, [visible, initialOrder, initialHidden, initialCustomFields, columns]);

  const usedSlots = useMemo(() => new Set(fields.map((f) => f.slot)), [fields]);

  // Column label lookup (including custom fields)
  const labelMap = useMemo(() => {
    const map = new Map(columns.map((c) => [c.key, c.label]));
    for (const f of fields) {
      map.set(f.slot, f.name);
    }
    return map;
  }, [columns, fields]);

  const moveColumn = (idx: number, direction: -1 | 1) => {
    const newOrder = [...order];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];
    setOrder(newOrder);
  };

  const toggleVisibility = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAddField = () => {
    if (!newFieldName.trim()) return;
    const slot = getNextAvailableSlot(newFieldType, usedSlots);
    if (!slot) return;
    const isSelectType =
      newFieldType === "dropdown" || newFieldType === "multiselect";
    const normalizedOptions = newFieldOptions
      .map((o) => o.trim().replace(/;/g, ""))
      .filter(Boolean);
    if (isSelectType && normalizedOptions.length === 0) {
      Alert.alert(
        "Missing options",
        "Add at least one option for dropdown and multi-select fields.",
      );
      return;
    }

    const newField: CustomFieldDef = {
      slot,
      name: newFieldName.trim(),
      type: newFieldType,
      ...(isSelectType ? { options: normalizedOptions } : {}),
    };

    setFields((prev) => [...prev, newField]);
    // Add to order if not already there
    setOrder((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
    // Reset form
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldOptions([]);
    setShowAddField(false);
  };

  const handleDeleteField = (idx: number) => {
    const field = fields[idx];
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setOrder((prev) => prev.filter((k) => k !== field.slot));
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(field.slot);
      return next;
    });
    if (editingFieldIdx === idx) setEditingFieldIdx(null);
  };

  const handleSave = () => {
    onSave({
      columnOrder: order,
      hiddenColumns: [...hidden],
      customFields: fields,
    });
  };

  // Capacity indicators
  const capacityInfo = useMemo(() => {
    const slotsByPrefix: Record<string, number> = {
      text: 0,
      number: 0,
      boolean: 0,
    };
    for (const f of fields) {
      if (f.slot.startsWith("customText")) slotsByPrefix.text++;
      else if (f.slot.startsWith("customNum")) slotsByPrefix.number++;
      else if (f.slot.startsWith("customBool")) slotsByPrefix.boolean++;
    }
    return slotsByPrefix;
  }, [fields]);

  const canAddType = (type: string): boolean => {
    return getNextAvailableSlot(type, usedSlots) !== null;
  };

  // Type badge background colors (branded/semantic, kept as-is per rules)
  const typeBadgeColors: Record<string, string> = {
    text: isDark ? '#1e3a5f' : '#DBEAFE',
    number: isDark ? '#1a3a2a' : '#D1FAE5',
    boolean: isDark ? '#3a3520' : '#FEF3C7',
    dropdown: isDark ? '#2d1f4e' : '#EDE9FE',
    multiselect: isDark ? '#3a1f30' : '#FCE7F3',
  };

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title="Configure Columns"
      width={520}
    >
      <View style={styles.container}>
        {/* Section 1: Column Order & Visibility */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Column Order & Visibility</Text>
        <ScrollView style={styles.columnList}>
          {order.map((key, idx) => {
            const label = labelMap.get(key) ?? key;
            const isHidden = hidden.has(key);
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
                      size={16}
                      color={idx === 0 ? colors.buttonDisabled : colors.icon}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveColumn(idx, 1)}
                    disabled={idx === order.length - 1}
                    style={styles.arrowBtn}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={idx === order.length - 1 ? colors.buttonDisabled : colors.icon}
                    />
                  </TouchableOpacity>
                </View>
                <Text
                  style={[
                    styles.columnLabel,
                    { color: colors.text },
                    isHidden && { color: colors.buttonDisabled, textDecorationLine: "line-through" as const },
                  ]}
                >
                  {label}
                </Text>
                <TouchableOpacity
                  onPress={() => toggleVisibility(key)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={isHidden ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={isHidden ? colors.buttonDisabled : colors.icon}
                  />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        {/* Section 2: Custom Fields */}
        <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Custom Fields</Text>

        {/* Capacity indicators */}
        <View style={styles.capacityRow}>
          {Object.entries(SLOT_CAPACITIES).map(([key, info]) => (
            <View key={key} style={[styles.capacityBadge, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.capacityText, { color: colors.textSecondary }]}>
                {info.label}: {capacityInfo[key] ?? 0}/{info.total}
              </Text>
            </View>
          ))}
        </View>

        {/* Existing custom fields */}
        {fields.map((field, idx) => (
          <View key={field.slot} style={[styles.fieldRow, { backgroundColor: colors.surfaceSecondary }]}>
            <View style={styles.fieldInfo}>
              <Text style={[styles.fieldName, { color: colors.text }]}>{field.name}</Text>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: typeBadgeColors[field.type] || colors.border },
                ]}
              >
                <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>{field.type}</Text>
              </View>
              {(field.type === "dropdown" || field.type === "multiselect") &&
                field.options && (
                  <Text style={[styles.fieldOptions, { color: colors.textTertiary }]} numberOfLines={1}>
                    ({field.options.join(", ")})
                  </Text>
                )}
            </View>
            <TouchableOpacity
              onPress={() => handleDeleteField(idx)}
              style={styles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Add custom field form */}
        {showAddField ? (
          <View style={[styles.addFieldForm, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <TextInput
              style={[styles.fieldInput, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
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
                      isActive && { borderColor: colors.link, backgroundColor: colors.selectedBackground },
                      !enabled && styles.typeOptionDisabled,
                    ]}
                    onPress={() => enabled && setNewFieldType(ft.value)}
                    disabled={!enabled}
                  >
                    <Text
                      style={[
                        styles.typeOptionText,
                        { color: colors.text },
                        isActive && { color: colors.link, fontWeight: "600" as const },
                        !enabled && { color: colors.textTertiary },
                      ]}
                    >
                      {ft.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Dropdown / Multi-Select options editor */}
            {(newFieldType === "dropdown" ||
              newFieldType === "multiselect") && (
              <View style={styles.optionsEditor}>
                <Text style={[styles.optionsLabel, { color: colors.textSecondary }]}>Options:</Text>
                {newFieldOptions.map((opt, i) => (
                  <View key={i} style={styles.optionRow}>
                    <TextInput
                      style={[styles.optionInput, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
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
                      onPress={() =>
                        setNewFieldOptions(
                          newFieldOptions.filter((_, j) => j !== i),
                        )
                      }
                      style={styles.optionDeleteBtn}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.iconSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() => setNewFieldOptions([...newFieldOptions, ""])}
                  style={styles.addOptionBtn}
                >
                  <Ionicons name="add" size={14} color={colors.link} />
                  <Text style={[styles.addOptionText, { color: colors.link }]}>Add option</Text>
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
                <Text style={[styles.cancelFieldText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAddField}
                style={[
                  styles.confirmFieldBtn,
                  { backgroundColor: colors.link },
                  (!newFieldName.trim() || !canAddType(newFieldType)) &&
                    styles.btnDisabled,
                ]}
                disabled={!newFieldName.trim() || !canAddType(newFieldType)}
              >
                <Text style={[styles.confirmFieldText, { color: colors.textInverse }]}>Add Field</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowAddField(true)}
            style={styles.addFieldButton}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.link} />
            <Text style={[styles.addFieldButtonText, { color: colors.link }]}>Add Custom Field</Text>
          </TouchableOpacity>
        )}

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.footerCancelBtn, { backgroundColor: colors.surfaceSecondary }]}
            disabled={isSaving}
          >
            <Text style={[styles.footerCancelText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.footerSaveBtn, { backgroundColor: colors.link }, isSaving && styles.btnDisabled]}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={[styles.footerSaveText, { color: colors.textInverse }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  sectionDivider: {
    height: 1,
    marginVertical: 4,
  },
  columnList: {
    maxHeight: 260,
  },
  columnRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  columnArrows: {
    flexDirection: "row" as const,
    gap: 2,
    marginRight: 8,
  },
  arrowBtn: {
    padding: 2,
  },
  columnLabel: {
    flex: 1,
    fontSize: 14,
  },
  eyeBtn: {
    padding: 4,
  },

  // Capacity
  capacityRow: {
    flexDirection: "row" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  },
  capacityBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  capacityText: {
    fontSize: 11,
    fontWeight: "500" as const,
  },

  // Field rows
  fieldRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 8,
  },
  fieldInfo: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  fieldName: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  fieldOptions: {
    fontSize: 12,
    flex: 1,
  },
  deleteBtn: {
    padding: 4,
  },

  // Add field form
  addFieldForm: {
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
  },
  fieldInput: {
    fontSize: 14,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  typePickerRow: {
    flexDirection: "row" as const,
    gap: 6,
  },
  typeOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeOptionDisabled: {
    opacity: 0.4,
  },
  typeOptionText: {
    fontSize: 13,
  },

  // Dropdown options editor
  optionsEditor: {
    gap: 6,
  },
  optionsLabel: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  optionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  optionInput: {
    flex: 1,
    fontSize: 13,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  optionDeleteBtn: {
    padding: 2,
  },
  addOptionBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingVertical: 4,
  },
  addOptionText: {
    fontSize: 12,
  },

  // Add field actions
  addFieldActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: 8,
  },
  cancelFieldBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cancelFieldText: {
    fontSize: 13,
  },
  confirmFieldBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  confirmFieldText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Add field button
  addFieldButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 8,
  },
  addFieldButtonText: {
    fontSize: 14,
    fontWeight: "500" as const,
  },

  // Footer
  footer: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: 10,
    marginTop: 8,
    borderTopWidth: 1,
    paddingTop: 16,
  },
  footerCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  footerCancelText: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  footerSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center" as const,
  },
  footerSaveText: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
});
