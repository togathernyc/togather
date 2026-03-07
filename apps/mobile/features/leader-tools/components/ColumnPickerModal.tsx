import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";

// ============================================================================
// Types
// ============================================================================

export type CustomFieldDef = {
  slot: string;
  name: string;
  type: "text" | "number" | "boolean" | "dropdown";
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

// System columns that can't be reordered/hidden
const SYSTEM_COLUMNS = new Set(["checkbox", "rowNum"]);

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
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
  // Local editing state
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "boolean" | "dropdown">("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [showAddField, setShowAddField] = useState(false);

  // Reset local state when modal opens or when initial values change
  React.useEffect(() => {
    if (visible) {
      // Build the full order from config or default
      const allKeys = columns.map((c) => c.key).filter((k) => !SYSTEM_COLUMNS.has(k));
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

  const usedSlots = useMemo(
    () => new Set(fields.map((f) => f.slot)),
    [fields]
  );

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

    const newField: CustomFieldDef = {
      slot,
      name: newFieldName.trim(),
      type: newFieldType,
      ...(newFieldType === "dropdown" && newFieldOptions.length > 0
        ? { options: newFieldOptions.filter((o) => o.trim()) }
        : {}),
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
    const slotsByPrefix: Record<string, number> = { text: 0, number: 0, boolean: 0 };
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

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title="Configure Columns"
      width={520}
    >
      <View style={styles.container}>
        {/* Section 1: Column Order & Visibility */}
        <Text style={styles.sectionTitle}>Column Order & Visibility</Text>
        <ScrollView style={styles.columnList}>
          {order.map((key, idx) => {
            const label = labelMap.get(key) ?? key;
            const isHidden = hidden.has(key);
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
                      size={16}
                      color={idx === 0 ? "#D1D5DB" : "#6B7280"}
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
                      color={idx === order.length - 1 ? "#D1D5DB" : "#6B7280"}
                    />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.columnLabel, isHidden && styles.columnLabelHidden]}>
                  {label}
                </Text>
                <TouchableOpacity
                  onPress={() => toggleVisibility(key)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={isHidden ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={isHidden ? "#D1D5DB" : "#6B7280"}
                  />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        {/* Section 2: Custom Fields */}
        <View style={styles.sectionDivider} />
        <Text style={styles.sectionTitle}>Custom Fields</Text>

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
        {fields.map((field, idx) => (
          <View key={field.slot} style={styles.fieldRow}>
            <View style={styles.fieldInfo}>
              <Text style={styles.fieldName}>{field.name}</Text>
              <View style={[styles.typeBadge, styles[`typeBadge_${field.type}` as keyof typeof styles] as any]}>
                <Text style={styles.typeBadgeText}>{field.type}</Text>
              </View>
              {field.type === "dropdown" && field.options && (
                <Text style={styles.fieldOptions} numberOfLines={1}>
                  ({field.options.join(", ")})
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => handleDeleteField(idx)} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        ))}

        {/* Add custom field form */}
        {showAddField ? (
          <View style={styles.addFieldForm}>
            <TextInput
              style={styles.fieldInput}
              value={newFieldName}
              onChangeText={setNewFieldName}
              placeholder="Field name..."
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
                      isActive && styles.typeOptionActive,
                      !enabled && styles.typeOptionDisabled,
                    ]}
                    onPress={() => enabled && setNewFieldType(ft.value)}
                    disabled={!enabled}
                  >
                    <Text
                      style={[
                        styles.typeOptionText,
                        isActive && styles.typeOptionTextActive,
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
                      style={styles.optionInput}
                      value={opt}
                      onChangeText={(text) => {
                        const next = [...newFieldOptions];
                        next[i] = text;
                        setNewFieldOptions(next);
                      }}
                      placeholder={`Option ${i + 1}`}
                    />
                    <TouchableOpacity
                      onPress={() => setNewFieldOptions(newFieldOptions.filter((_, j) => j !== i))}
                      style={styles.optionDeleteBtn}
                    >
                      <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() => setNewFieldOptions([...newFieldOptions, ""])}
                  style={styles.addOptionBtn}
                >
                  <Ionicons name="add" size={14} color="#2563EB" />
                  <Text style={styles.addOptionText}>Add option</Text>
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
                  (!newFieldName.trim() || !canAddType(newFieldType)) && styles.btnDisabled,
                ]}
                disabled={!newFieldName.trim() || !canAddType(newFieldType)}
              >
                <Text style={styles.confirmFieldText}>Add Field</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowAddField(true)}
            style={styles.addFieldButton}
          >
            <Ionicons name="add-circle-outline" size={18} color="#2563EB" />
            <Text style={styles.addFieldButtonText}>Add Custom Field</Text>
          </TouchableOpacity>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={onClose} style={styles.footerCancelBtn} disabled={isSaving}>
            <Text style={styles.footerCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.footerSaveBtn, isSaving && styles.btnDisabled]}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.footerSaveText}>Save</Text>
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
    color: "#374151",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
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
    borderBottomColor: "#F3F4F6",
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
    color: "#374151",
  },
  columnLabelHidden: {
    color: "#D1D5DB",
    textDecorationLine: "line-through" as const,
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
    backgroundColor: "#F3F4F6",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  capacityText: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "500" as const,
  },

  // Field rows
  fieldRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: "#F9FAFB",
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
    color: "#374151",
    fontWeight: "500" as const,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#E5E7EB",
  },
  typeBadge_text: { backgroundColor: "#DBEAFE" },
  typeBadge_number: { backgroundColor: "#D1FAE5" },
  typeBadge_boolean: { backgroundColor: "#FEF3C7" },
  typeBadge_dropdown: { backgroundColor: "#EDE9FE" },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: "#6B7280",
  },
  fieldOptions: {
    fontSize: 12,
    color: "#9CA3AF",
    flex: 1,
  },
  deleteBtn: {
    padding: 4,
  },

  // Add field form
  addFieldForm: {
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  fieldInput: {
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
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
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  typeOptionActive: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  typeOptionDisabled: {
    opacity: 0.4,
  },
  typeOptionText: {
    fontSize: 13,
    color: "#374151",
  },
  typeOptionTextActive: {
    color: "#2563EB",
    fontWeight: "600" as const,
  },
  typeOptionTextDisabled: {
    color: "#9CA3AF",
  },

  // Dropdown options editor
  optionsEditor: {
    gap: 6,
  },
  optionsLabel: {
    fontSize: 12,
    color: "#6B7280",
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
    borderColor: "#D1D5DB",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#fff",
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
    color: "#2563EB",
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
    color: "#6B7280",
  },
  confirmFieldBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#2563EB",
  },
  confirmFieldText: {
    fontSize: 13,
    color: "#fff",
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
    color: "#2563EB",
    fontWeight: "500" as const,
  },

  // Footer
  footer: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 16,
  },
  footerCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  footerCancelText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500" as const,
  },
  footerSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#2563EB",
    minWidth: 80,
    alignItems: "center" as const,
  },
  footerSaveText: {
    fontSize: 14,
    color: "#fff",
    fontWeight: "600" as const,
  },
});
