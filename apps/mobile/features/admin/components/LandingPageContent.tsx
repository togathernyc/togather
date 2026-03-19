/**
 * LandingPageContent - Admin configuration for the community landing page.
 *
 * Three sections:
 * 1. Page Settings (enable/disable, title, description, etc.)
 * 2. Form Fields (configure custom fields for the intake form)
 * 3. Automation Rules (auto-assign based on field values)
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useLandingPageConfig } from "../hooks/useLandingPageConfig";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import type { Id } from "@services/api/convex";

// Available custom field slots
const TEXT_SLOTS = ["customText1", "customText2", "customText3", "customText4", "customText5"];
const NUM_SLOTS = ["customNum1", "customNum2", "customNum3", "customNum4", "customNum5"];
const BOOL_SLOTS = [
  "customBool1", "customBool2", "customBool3", "customBool4", "customBool5",
  "customBool6", "customBool7", "customBool8", "customBool9", "customBool10",
];

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Checkbox" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-Select" },
  { value: "button", label: "Button" },
  { value: "section_header", label: "Section Header" },
  { value: "subtitle", label: "Subtitle" },
];

const DECORATIVE_TYPES = new Set(["section_header", "subtitle", "button"]);
const HTTP_URL_REGEX = /^https?:\/\/\S+$/i;

const OPERATORS = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not Equals" },
  { value: "contains", label: "Contains" },
  { value: "is_true", label: "Is Checked" },
  { value: "is_false", label: "Is Not Checked" },
];

// Built-in fields that are always included on the form (non-editable)
const FIXED_BUILT_IN_FIELDS = [
  { label: "First Name", type: "text", required: true },
  { label: "Last Name", type: "text", required: true },
  { label: "Phone", type: "phone", required: true },
  { label: "Email", type: "email", required: false },
];


type FormField = {
  slot?: string;
  label: string;
  type: string;
  placeholder?: string;
  options?: string[];
  buttonUrl?: string;
  required: boolean;
  order: number;
  includeInNotes?: boolean;
  showOnLanding?: boolean;
};

type AutomationRule = {
  id: string;
  name: string;
  isEnabled: boolean;
  condition: {
    field: string;
    operator: string;
    value?: string;
  };
  action: {
    type: string;
    assigneePhone?: string;
    assigneeUserId?: Id<"users">;
  };
};

export function LandingPageContent() {
  const { colors, isDark } = useTheme();
  const { config, communitySlug, followupCustomFields, isLoading, isSaving, saveConfig } =
    useLandingPageConfig();

  // Page settings state
  const [isEnabled, setIsEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitButtonText, setSubmitButtonText] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [generateNoteSummary, setGenerateNoteSummary] = useState(true);
  const [requireZipCode, setRequireZipCode] = useState(false);
  const [requireBirthday, setRequireBirthday] = useState(false);

  // Form fields state
  const [formFields, setFormFields] = useState<FormField[]>([]);

  // Automation rules state
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);

  // Modal state
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);

  // Dirty tracking
  const [isDirty, setIsDirty] = useState(false);

  // Initialize from config, merging follow-up custom fields
  useEffect(() => {
    if (config) {
      setIsEnabled(config.isEnabled);
      setTitle(config.title || "");
      setDescription(config.description || "");
      setSubmitButtonText(config.submitButtonText || "");
      setSuccessMessage(config.successMessage || "");
      setGenerateNoteSummary(config.generateNoteSummary ?? true);
      setRequireZipCode(config.requireZipCode ?? false);
      setRequireBirthday(config.requireBirthday ?? false);

      // Merge landing page fields with follow-up custom fields (two-way sync)
      const landingFields: FormField[] = (config.formFields || []).map((f: any) => ({
        ...f,
        includeInNotes: f.includeInNotes ?? true,
        showOnLanding: f.showOnLanding ?? true,
      }));
      const landingSlotsSet = new Set(
        landingFields.map((f) => f.slot).filter(Boolean)
      );

      // Add follow-up custom fields not already in landing page config
      const followupOnly: FormField[] = (followupCustomFields || [])
        .filter(
          (f: { slot: string }) => f.slot && !landingSlotsSet.has(f.slot)
        )
        .map((f: { slot: string; name: string; type: string; options?: string[] }, i: number) => ({
          slot: f.slot,
          label: f.name,
          type: f.type,
          options: f.options,
          required: false,
          order: landingFields.length + i,
          includeInNotes: true,
          showOnLanding: true,
        }));

      // Normalize orders on load to fix gaps/duplicates from previous edits
      const merged = [...landingFields, ...followupOnly]
        .sort((a, b) => a.order - b.order)
        .map((f, i) => ({ ...f, order: i }));
      setFormFields(merged);

      setAutomationRules(
        (config.automationRules || []).map((r: any) => ({
          ...r,
          action: {
            type: r.action.type,
            assigneePhone: r.action.assigneePhone,
            assigneeUserId: r.action.assigneeUserId,
          },
        }))
      );
      setIsDirty(false);
    }
  }, [config, followupCustomFields]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const moveField = useCallback((index: number, direction: -1 | 1) => {
    setFormFields((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= sorted.length) return prev;
      // Swap positions in the array (not order values — avoids no-op when orders are equal)
      const temp = sorted[index];
      sorted[index] = sorted[targetIdx];
      sorted[targetIdx] = temp;
      // Reassign sequential orders to prevent gaps and duplicates
      return sorted.map((field, i) => ({ ...field, order: i }));
    });
    markDirty();
  }, [markDirty]);

  const handleSave = async () => {
    try {
      await saveConfig({
        isEnabled,
        title: title || undefined,
        description: description || undefined,
        submitButtonText: submitButtonText || undefined,
        successMessage: successMessage || undefined,
        generateNoteSummary,
        requireZipCode,
        requireBirthday,
        formFields,
        automationRules,
      });
      setIsDirty(false);
      Alert.alert("Saved", "Landing page configuration saved successfully.");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save configuration");
    }
  };

  const usedSlots = new Set(formFields.map((f) => f.slot).filter(Boolean));

  const getAvailableSlots = (currentSlot?: string) => {
    const available: { value: string; label: string }[] = [
      { value: "", label: "No slot (notes only)" },
    ];
    for (const slot of [...TEXT_SLOTS, ...NUM_SLOTS, ...BOOL_SLOTS]) {
      if (!usedSlots.has(slot) || slot === currentSlot) {
        available.push({ value: slot, label: slot });
      }
    }
    return available;
  };

  const getCommunityLandingLink = (slug: string) => {
    const domainConfig = DOMAIN_CONFIG as typeof DOMAIN_CONFIG & {
      communityLandingUrl?: (communitySlug: string) => string;
    };
    return domainConfig.communityLandingUrl
      ? domainConfig.communityLandingUrl(slug)
      : `${DOMAIN_CONFIG.landingUrl}/c/${slug}`;
  };

  const handleCopyLink = async () => {
    if (communitySlug) {
      const url = getCommunityLandingLink(communitySlug);
      await Clipboard.setStringAsync(url);
      Alert.alert("Copied", "Landing page link copied to clipboard.");
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
    >
      {/* ================================================================ */}
      {/* Section 1: Page Settings */}
      {/* ================================================================ */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Page Settings</Text>

        <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>Enabled</Text>
          <Switch
            value={isEnabled}
            onValueChange={(v) => {
              setIsEnabled(v);
              markDirty();
            }}
          />
        </View>

        {communitySlug && (
          <TouchableOpacity style={[styles.linkRow, { backgroundColor: colors.surfaceSecondary }]} onPress={handleCopyLink}>
            <Text style={[styles.linkText, { color: colors.link }]}>
              {getCommunityLandingLink(communitySlug)}
            </Text>
            <Ionicons name="copy-outline" size={18} color={colors.icon} />
          </TouchableOpacity>
        )}

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>Title</Text>
          <TextInput
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              markDirty();
            }}
            placeholder="Welcome to our community"
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>Description</Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={description}
            onChangeText={(v) => {
              setDescription(v);
              markDirty();
            }}
            placeholder="We'd love to get to know you!"
            multiline
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>Submit Button Text</Text>
          <TextInput
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={submitButtonText}
            onChangeText={(v) => {
              setSubmitButtonText(v);
              markDirty();
            }}
            placeholder="Join"
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>Success Message</Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={successMessage}
            onChangeText={(v) => {
              setSuccessMessage(v);
              markDirty();
            }}
            placeholder="Welcome! Download the app to stay connected."
            multiline
          />
        </View>

        <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: colors.text }]}>Generate Notes Summary</Text>
            <Text style={[styles.rowHint, { color: colors.textTertiary }]}>
              Save all responses as a follow-up note
            </Text>
          </View>
          <Switch
            value={generateNoteSummary}
            onValueChange={(v) => {
              setGenerateNoteSummary(v);
              markDirty();
            }}
          />
        </View>
      </View>

      {/* ================================================================ */}
      {/* Section 2: Form Fields */}
      {/* ================================================================ */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Form Fields</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.buttonPrimary }]}
            onPress={() => {
              setEditingFieldIndex(null);
              setShowFieldModal(true);
            }}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
          Built-in fields are always included. Add custom fields below.
        </Text>

        {/* Fixed built-in fields (always included, non-editable) */}
        {FIXED_BUILT_IN_FIELDS.map((field) => (
          <View key={field.label} style={[styles.listItem, { opacity: 0.5, borderBottomColor: colors.borderLight }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.listItemTitle, { color: colors.text }]}>{field.label}</Text>
              <Text style={[styles.listItemSubtitle, { color: colors.textTertiary }]}>
                {field.type}{field.required ? " · required" : " · optional"}
              </Text>
            </View>
            <Ionicons name="lock-closed" size={16} color={colors.textTertiary} style={{ padding: 8 }} />
          </View>
        ))}

        {/* Configurable built-in fields (ZIP Code, Birthday) */}
        <View style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.listItemTitle, { color: colors.text }]}>ZIP Code</Text>
            <Text style={[styles.listItemSubtitle, { color: colors.textTertiary }]}>
              text{requireZipCode ? " · required" : " · optional"}
            </Text>
          </View>
          <Switch
            value={requireZipCode}
            onValueChange={(val) => { setRequireZipCode(val); markDirty(); }}
            trackColor={{ false: colors.border, true: colors.success }}
          />
        </View>
        <View style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.listItemTitle, { color: colors.text }]}>Birthday</Text>
            <Text style={[styles.listItemSubtitle, { color: colors.textTertiary }]}>
              date{requireBirthday ? " · required" : " · optional"}
            </Text>
          </View>
          <Switch
            value={requireBirthday}
            onValueChange={(val) => { setRequireBirthday(val); markDirty(); }}
            trackColor={{ false: colors.border, true: colors.success }}
          />
        </View>


        {formFields.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No custom fields configured</Text>
        ) : (
          (() => {
            const sorted = [...formFields].sort((a, b) => a.order - b.order);
            return sorted.map((field, sortedIndex) => {
              const originalIndex = formFields.indexOf(field);
              const isDecorative = DECORATIVE_TYPES.has(field.type);
              return (
                <View key={field.slot || field.label || originalIndex} style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
                  <View style={styles.reorderButtons}>
                    <TouchableOpacity
                      onPress={() => moveField(sortedIndex, -1)}
                      disabled={sortedIndex === 0}
                      style={styles.iconButton}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={sortedIndex === 0 ? colors.iconSecondary : colors.icon}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveField(sortedIndex, 1)}
                      disabled={sortedIndex === sorted.length - 1}
                      style={styles.iconButton}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={sortedIndex === sorted.length - 1 ? colors.iconSecondary : colors.icon}
                      />
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {isDecorative && (
                        <Ionicons
                          name={
                            field.type === "section_header"
                              ? "remove-outline"
                              : field.type === "button"
                                ? "link-outline"
                                : "information-circle-outline"
                          }
                          size={16}
                          color={colors.textTertiary}
                        />
                      )}
                      <Text style={[
                        styles.listItemTitle,
                        { color: colors.text },
                        field.type === "section_header" && { fontWeight: "700" },
                        field.type === "subtitle" && { fontStyle: "italic", color: colors.textSecondary },
                      ]}>
                        {field.label}
                      </Text>
                    </View>
                    <Text style={[styles.listItemSubtitle, { color: colors.textTertiary }]}>
                      {field.type === "section_header" ? "section header" :
                       field.type === "subtitle" ? "subtitle" :
                       field.type === "button" ? "button" :
                       field.type === "multiselect" ? "multi-select" :
                       field.type}
                      {!isDecorative && (field.slot ? ` · ${field.slot}` : " · notes only")}
                      {!isDecorative && field.required ? " · required" : ""}
                      {field.showOnLanding === false ? " · hidden on form" : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setFormFields((prev) =>
                        prev.map((f, i) =>
                          i === originalIndex
                            ? { ...f, showOnLanding: f.showOnLanding === false ? true : false }
                            : f
                        )
                      );
                      markDirty();
                    }}
                    style={styles.iconButton}
                  >
                    <Ionicons
                      name={field.showOnLanding === false ? "eye-off-outline" : "eye-outline"}
                      size={18}
                      color={field.showOnLanding === false ? colors.textTertiary : colors.link}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingFieldIndex(originalIndex);
                      setShowFieldModal(true);
                    }}
                    style={styles.iconButton}
                  >
                    <Ionicons name="pencil" size={18} color={colors.icon} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setFormFields((prev) => {
                        const filtered = prev.filter((_, i) => i !== originalIndex);
                        // Renormalize orders to prevent gaps that cause duplicates on add
                        return [...filtered]
                          .sort((a, b) => a.order - b.order)
                          .map((f, i) => ({ ...f, order: i }));
                      });
                      markDirty();
                    }}
                    style={styles.iconButton}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              );
            });
          })()
        )}
      </View>

      {/* ================================================================ */}
      {/* Section 3: Automation Rules */}
      {/* ================================================================ */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Automation Rules</Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.buttonPrimary }]}
            onPress={() => {
              setEditingRuleIndex(null);
              setShowRuleModal(true);
            }}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {automationRules.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No rules configured</Text>
        ) : (
          automationRules.map((rule, index) => (
            <View key={rule.id} style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
              <Switch
                value={rule.isEnabled}
                onValueChange={(v) => {
                  setAutomationRules((prev) =>
                    prev.map((r, i) =>
                      i === index ? { ...r, isEnabled: v } : r
                    )
                  );
                  markDirty();
                }}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.listItemTitle, { color: colors.text }]}>{rule.name}</Text>
                <Text style={[styles.listItemSubtitle, { color: colors.textTertiary }]}>
                  If {rule.condition.field} {rule.condition.operator}
                  {rule.condition.value ? ` "${rule.condition.value}"` : ""} →{" "}
                  {rule.action.type === "set_assignee"
                    ? `assign to ${rule.action.assigneePhone || "..."}`
                    : rule.action.type}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setEditingRuleIndex(index);
                  setShowRuleModal(true);
                }}
                style={styles.iconButton}
              >
                <Ionicons name="pencil" size={18} color={colors.icon} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setAutomationRules((prev) => prev.filter((_, i) => i !== index));
                  markDirty();
                }}
                style={styles.iconButton}
              >
                <Ionicons name="trash-outline" size={18} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Save Button */}
      {isDirty && (
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.buttonPrimary }, isSaving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Field Modal */}
      <FieldEditorModal
        visible={showFieldModal}
        field={editingFieldIndex !== null ? formFields[editingFieldIndex] : undefined}
        availableSlots={getAvailableSlots(
          editingFieldIndex !== null ? formFields[editingFieldIndex]?.slot : undefined
        )}
        onSave={(field) => {
          if (editingFieldIndex !== null) {
            setFormFields((prev) =>
              prev.map((f, i) => (i === editingFieldIndex ? field : f))
            );
          } else {
            setFormFields((prev) => [
              ...prev,
              { ...field, order: prev.length },
            ]);
          }
          markDirty();
          setShowFieldModal(false);
          setEditingFieldIndex(null);
        }}
        onClose={() => {
          setShowFieldModal(false);
          setEditingFieldIndex(null);
        }}
      />

      {/* Rule Modal */}
      <RuleEditorModal
        visible={showRuleModal}
        rule={editingRuleIndex !== null ? automationRules[editingRuleIndex] : undefined}
        formFields={formFields}
        onSave={(rule) => {
          if (editingRuleIndex !== null) {
            setAutomationRules((prev) =>
              prev.map((r, i) => (i === editingRuleIndex ? rule : r))
            );
          } else {
            setAutomationRules((prev) => [...prev, rule]);
          }
          markDirty();
          setShowRuleModal(false);
          setEditingRuleIndex(null);
        }}
        onClose={() => {
          setShowRuleModal(false);
          setEditingRuleIndex(null);
        }}
      />
    </ScrollView>
  );
}

// ============================================================================
// Field Editor Modal
// ============================================================================

function FieldEditorModal({
  visible,
  field,
  availableSlots,
  onSave,
  onClose,
}: {
  visible: boolean;
  field?: FormField;
  availableSlots: { value: string; label: string }[];
  onSave: (field: FormField) => void;
  onClose: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [slot, setSlot] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");

  useEffect(() => {
    if (visible) {
      setLabel(field?.label || "");
      setType(field?.type || "text");
      setSlot(field?.slot || "");
      setRequired(field?.required || false);
      setOptions(field?.options?.join(", ") || "");
      setPlaceholder(field?.placeholder || "");
      setButtonUrl(field?.buttonUrl || "");
    }
  }, [visible, field]);

  const isDecorative = DECORATIVE_TYPES.has(type);

  const handleSave = () => {
    if (!label.trim()) {
      Alert.alert("Error", "Label is required");
      return;
    }

    if (isDecorative) {
      if (type === "button") {
        const trimmedUrl = buttonUrl.trim();
        if (!trimmedUrl) {
          Alert.alert("Error", "Button link is required");
          return;
        }
        if (!HTTP_URL_REGEX.test(trimmedUrl)) {
          Alert.alert("Error", "Button link must start with http:// or https://");
          return;
        }
      }
      onSave({
        label: label.trim(),
        type,
        buttonUrl: type === "button" ? buttonUrl.trim() : undefined,
        required: false,
        order: field?.order ?? 0,
        showOnLanding: field?.showOnLanding ?? true,
      });
      return;
    }

    // Validate semicolons in options for dropdown/multiselect
    if ((type === "dropdown" || type === "multiselect") && options.includes(";")) {
      Alert.alert("Error", "Option values cannot contain semicolons (;). Semicolons are reserved as the multi-select separator.");
      return;
    }

    const parsedOptions =
      type === "dropdown" || type === "multiselect"
        ? options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;

    if ((type === "dropdown" || type === "multiselect") && (!parsedOptions || parsedOptions.length === 0)) {
      Alert.alert("Error", "Add at least one option for dropdown and multi-select fields.");
      return;
    }

    // Auto-select a slot based on type if not explicitly chosen
    const resolvedSlot = slot || undefined;

    onSave({
      slot: resolvedSlot,
      label: label.trim(),
      type,
      placeholder: placeholder.trim() || undefined,
      required,
      order: field?.order ?? 0,
      options: parsedOptions,
      includeInNotes: true,
      showOnLanding: field?.showOnLanding ?? true,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[modalStyles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[modalStyles.container, { backgroundColor: colors.modalBackground }]}>
          <View style={[modalStyles.header, { borderBottomColor: colors.borderLight }]}>
            <Text style={[modalStyles.title, { color: colors.text }]}>
              {field ? "Edit Field" : "Add Field"}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={modalStyles.content}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Label</Text>
              <TextInput
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                value={label}
                onChangeText={setLabel}
                placeholder="e.g., Neighborhood"
              />
            </View>

            {!isDecorative && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Placeholder Text</Text>
                <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                  Hint text shown inside the field when empty
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={placeholder}
                  onChangeText={setPlaceholder}
                  placeholder="e.g., Enter your neighborhood"
                />
              </View>
            )}

            {type === "button" && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Button Link URL</Text>
                <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                  Full URL beginning with https://
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={buttonUrl}
                  onChangeText={setButtonUrl}
                  placeholder="https://example.com"
                  autoCapitalize="none"
                />
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Type</Text>
              <View style={modalStyles.chipContainer}>
                {FIELD_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[
                      modalStyles.chip, { borderColor: colors.inputBorder, backgroundColor: colors.buttonSecondary },
                      type === t.value && { borderColor: colors.success, backgroundColor: colors.selectedBackground },
                    ]}
                    onPress={() => {
                      setType(t.value);
                      // Reset slot if incompatible with new type
                      if (slot) {
                        const isCompatible =
                          (t.value === "text" || t.value === "dropdown" || t.value === "multiselect") ? slot.startsWith("customText") :
                          t.value === "number" ? slot.startsWith("customNum") :
                          t.value === "boolean" ? slot.startsWith("customBool") :
                          false;
                        if (!isCompatible) {
                          setSlot("");
                        }
                      }
                    }}
                  >
                    <Text
                      style={[
                        modalStyles.chipText, { color: colors.textSecondary },
                        type === t.value && { color: colors.success },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {type === "subtitle" && (
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                Supports links using [label](https://url) or plain https:// URLs.
              </Text>
            )}

            {!isDecorative && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Custom Field Slot</Text>
                <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                  Maps to a follow-up column. Leave empty for notes-only.
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 8 }}
                >
                  <View style={modalStyles.chipContainer}>
                    {availableSlots
                      .filter((s) => {
                        if (!s.value) return true; // "No slot" always shows
                        if (type === "text" || type === "dropdown" || type === "multiselect")
                          return s.value.startsWith("customText");
                        if (type === "number") return s.value.startsWith("customNum");
                        if (type === "boolean") return s.value.startsWith("customBool");
                        return false;
                      })
                      .map((s) => (
                        <TouchableOpacity
                          key={s.value}
                          style={[
                            modalStyles.chip, { borderColor: colors.inputBorder, backgroundColor: colors.buttonSecondary },
                            slot === s.value && { borderColor: colors.success, backgroundColor: colors.selectedBackground },
                          ]}
                          onPress={() => setSlot(s.value)}
                        >
                          <Text
                            style={[
                              modalStyles.chipText, { color: colors.textSecondary },
                              slot === s.value && { color: colors.success },
                            ]}
                          >
                            {s.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {!isDecorative && (type === "dropdown" || type === "multiselect") && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>Options (comma-separated)</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={options}
                  onChangeText={setOptions}
                  placeholder="Option 1, Option 2, Option 3"
                />
              </View>
            )}

            {!isDecorative && (
              <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>Required</Text>
                <Switch value={required} onValueChange={setRequired} />
              </View>
            )}
          </ScrollView>

          <TouchableOpacity style={[modalStyles.saveButton, { backgroundColor: colors.buttonPrimary }]} onPress={handleSave}>
            <Text style={modalStyles.saveButtonText}>
              {field ? "Update" : "Add"} Field
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Rule Editor Modal
// ============================================================================

function RuleEditorModal({
  visible,
  rule,
  formFields,
  onSave,
  onClose,
}: {
  visible: boolean;
  rule?: AutomationRule;
  formFields: FormField[];
  onSave: (rule: AutomationRule) => void;
  onClose: () => void;
}) {
  const { colors, isDark } = useTheme();
  const [name, setName] = useState("");
  const [conditionField, setConditionField] = useState("");
  const [conditionOperator, setConditionOperator] = useState("is_true");
  const [conditionValue, setConditionValue] = useState("");
  const [assigneePhone, setAssigneePhone] = useState("");

  useEffect(() => {
    if (visible) {
      setName(rule?.name || "");
      setConditionField(rule?.condition.field || "");
      setConditionOperator(rule?.condition.operator || "is_true");
      setConditionValue(rule?.condition.value || "");
      setAssigneePhone(rule?.action.assigneePhone || "");
    }
  }, [visible, rule]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("Error", "Rule name is required");
      return;
    }
    if (!conditionField) {
      Alert.alert("Error", "Select a field for the condition");
      return;
    }

    onSave({
      id: rule?.id || `rule_${Date.now()}`,
      name: name.trim(),
      isEnabled: rule?.isEnabled ?? true,
      condition: {
        field: conditionField,
        operator: conditionOperator,
        value: conditionValue || undefined,
      },
      action: {
        type: "set_assignee",
        assigneePhone: assigneePhone || undefined,
        assigneeUserId: rule?.action.assigneeUserId,
      },
    });
  };

  const showValueInput = !["is_true", "is_false"].includes(conditionOperator);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[modalStyles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[modalStyles.container, { backgroundColor: colors.modalBackground }]}>
          <View style={[modalStyles.header, { borderBottomColor: colors.borderLight }]}>
            <Text style={[modalStyles.title, { color: colors.text }]}>
              {rule ? "Edit Rule" : "Add Rule"}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={modalStyles.content}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Rule Name</Text>
              <TextInput
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                value={name}
                onChangeText={setName}
                placeholder="e.g., Assign Dinner Party leads"
              />
            </View>

            <Text style={[styles.fieldLabel, { color: colors.text }]}>Condition</Text>
            <View style={styles.field}>
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>When this field...</Text>
              <View style={modalStyles.chipContainer}>
                {formFields.map((f) => (
                  <TouchableOpacity
                    key={f.slot || f.label}
                    style={[
                      modalStyles.chip, { borderColor: colors.inputBorder, backgroundColor: colors.buttonSecondary },
                      conditionField === (f.slot || f.label) &&
                        { borderColor: colors.success, backgroundColor: colors.selectedBackground },
                    ]}
                    onPress={() => setConditionField(f.slot || f.label)}
                  >
                    <Text
                      style={[
                        modalStyles.chipText, { color: colors.textSecondary },
                        conditionField === (f.slot || f.label) &&
                          { color: colors.success },
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>...matches this condition</Text>
              <View style={modalStyles.chipContainer}>
                {OPERATORS.map((op) => (
                  <TouchableOpacity
                    key={op.value}
                    style={[
                      modalStyles.chip, { borderColor: colors.inputBorder, backgroundColor: colors.buttonSecondary },
                      conditionOperator === op.value && { borderColor: colors.success, backgroundColor: colors.selectedBackground },
                    ]}
                    onPress={() => setConditionOperator(op.value)}
                  >
                    <Text
                      style={[
                        modalStyles.chipText, { color: colors.textSecondary },
                        conditionOperator === op.value &&
                          { color: colors.success },
                      ]}
                    >
                      {op.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {showValueInput && (
              <View style={styles.field}>
                <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>...with this value</Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={conditionValue}
                  onChangeText={setConditionValue}
                  placeholder="Value to match"
                />
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 8, color: colors.text }]}>Action</Text>
            <View style={styles.field}>
              <Text style={[styles.fieldHint, { color: colors.textTertiary }]}>
                Set assignee (enter phone number)
              </Text>
              <TextInput
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                value={assigneePhone}
                onChangeText={setAssigneePhone}
                placeholder="(555) 555-5555"
                keyboardType="phone-pad"
              />
            </View>
          </ScrollView>

          <TouchableOpacity style={[modalStyles.saveButton, { backgroundColor: colors.buttonPrimary }]} onPress={handleSave}>
            <Text style={modalStyles.saveButtonText}>
              {rule ? "Update" : "Add"} Rule
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  sectionHint: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowLabel: {
    fontSize: 16,
  },
  rowHint: {
    fontSize: 12,
    marginTop: 2,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  linkText: {
    fontSize: 14,
    flex: 1,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 12,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  reorderButtons: {
    flexDirection: "column",
    marginRight: 4,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  listItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    padding: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
  saveButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 32,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  content: {
    padding: 16,
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: {
  },
  chipText: {
    fontSize: 13,
  },
  chipTextSelected: {
    fontWeight: "600",
  },
  saveButton: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
