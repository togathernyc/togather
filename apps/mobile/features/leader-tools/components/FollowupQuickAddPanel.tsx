import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { api, Id, useAuthenticatedMutation } from "@services/api/convex";
import type { CustomFieldDef } from "./ColumnPickerModal";
import { normalizeSelectOptions } from "./followupSelectFields";
import {
  buildQuickAddCustomFieldValues,
  validateQuickAddRequiredFields,
} from "./followupQuickAddHelpers";

type LeaderOption = {
  id: string;
  firstName: string;
  lastName: string;
};

type Props = {
  groupId: string;
  customFields: CustomFieldDef[];
  leaderOptions: LeaderOption[];
  primaryColor: string;
  onCancel: () => void;
  onCreated?: (result: { groupMemberId: string; userId: string }) => void;
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error";
}

export function FollowupQuickAddPanel({
  groupId,
  customFields,
  leaderOptions,
  primaryColor,
  onCancel,
  onCreated,
}: Props) {
  const quickAddRow = useAuthenticatedMutation(api.functions.memberFollowups.quickAddRow);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("__none__");
  const [assigneeId, setAssigneeId] = useState("__none__");
  const [customValues, setCustomValues] = useState<
    Record<string, string | string[] | boolean | undefined>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sortedCustomFields = useMemo(
    () => [...customFields].sort((a, b) => a.name.localeCompare(b.name)),
    [customFields]
  );

  const setCustomValue = (
    slot: string,
    value: string | string[] | boolean | undefined
  ) => {
    setCustomValues((prev) => ({ ...prev, [slot]: value }));
  };

  const toggleMultiValue = (slot: string, option: string) => {
    setCustomValues((prev) => {
      const current = Array.isArray(prev[slot]) ? prev[slot] : [];
      const exists = current.includes(option);
      const next = exists
        ? current.filter((value) => value !== option)
        : [...current, option];
      return { ...prev, [slot]: next };
    });
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const missing = validateQuickAddRequiredFields(firstName, phone);
    if (missing.length > 0) {
      setValidationError(`Please provide ${missing.join(" and ")}.`);
      return;
    }
    setValidationError(null);

    const customFieldValues = buildQuickAddCustomFieldValues(customFields, customValues);
    setIsSaving(true);
    try {
      const result = await quickAddRow({
        groupId: groupId as Id<"groups">,
        firstName: firstName.trim(),
        phone: phone.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        zipCode: zipCode.trim() || undefined,
        dateOfBirth: dateOfBirth.trim() || undefined,
        notes: notes.trim() || undefined,
        status: status !== "__none__" ? status : undefined,
        assigneeId: assigneeId !== "__none__" ? (assigneeId as Id<"users">) : undefined,
        customFieldValues,
      });

      Alert.alert("Person added", "They were added to the group and follow-up list.");
      onCreated?.({
        groupMemberId: String(result.groupMemberId),
        userId: String(result.userId),
      });
    } catch (error: unknown) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Add person</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Required</Text>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>First name *</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setValidationError(null);
              }}
              placeholder="First name"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Phone *</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setValidationError(null);
              }}
              placeholder="(555) 555-1234"
              keyboardType="phone-pad"
              editable={!isSaving}
            />
          </View>
          {validationError && <Text style={styles.errorText}>{validationError}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>ZIP code</Text>
            <TextInput
              style={styles.input}
              value={zipCode}
              onChangeText={setZipCode}
              placeholder="ZIP code"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Birthday</Text>
            <TextInput
              style={styles.input}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional note"
              multiline
              numberOfLines={3}
              editable={!isSaving}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Follow-up fields</Text>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={status}
                onValueChange={(value) => setStatus(String(value))}
                enabled={!isSaving}
              >
                <Picker.Item label="Not set" value="__none__" />
                {STATUS_OPTIONS.map((option) => (
                  <Picker.Item key={option.value} label={option.label} value={option.value} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Assignee</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={assigneeId}
                onValueChange={(value) => setAssigneeId(String(value))}
                enabled={!isSaving}
              >
                <Picker.Item label="Unassigned" value="__none__" />
                {leaderOptions.map((leader) => (
                  <Picker.Item
                    key={leader.id}
                    label={`${leader.firstName} ${leader.lastName}`.trim()}
                    value={leader.id}
                  />
                ))}
              </Picker>
            </View>
          </View>

          {sortedCustomFields.map((field) => {
            if (field.type === "boolean") {
              const selectedValue = customValues[field.slot] as boolean | undefined;
              return (
                <View key={field.slot} style={styles.fieldWrap}>
                  <Text style={styles.label}>{field.name}</Text>
                  <View style={styles.booleanRow}>
                    <TouchableOpacity
                      style={[styles.booleanButton, selectedValue === undefined && styles.booleanSelected]}
                      onPress={() => setCustomValue(field.slot, undefined)}
                      disabled={isSaving}
                    >
                      <Text style={styles.booleanText}>Not set</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.booleanButton, selectedValue === true && styles.booleanSelected]}
                      onPress={() => setCustomValue(field.slot, true)}
                      disabled={isSaving}
                    >
                      <Text style={styles.booleanText}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.booleanButton, selectedValue === false && styles.booleanSelected]}
                      onPress={() => setCustomValue(field.slot, false)}
                      disabled={isSaving}
                    >
                      <Text style={styles.booleanText}>No</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            if (field.type === "dropdown") {
              const options = normalizeSelectOptions(field.options);
              return (
                <View key={field.slot} style={styles.fieldWrap}>
                  <Text style={styles.label}>{field.name}</Text>
                  <View style={styles.pickerWrap}>
                    <Picker
                      selectedValue={(customValues[field.slot] as string | undefined) ?? "__none__"}
                      onValueChange={(value) => {
                        const next = String(value);
                        setCustomValue(field.slot, next === "__none__" ? undefined : next);
                      }}
                      enabled={!isSaving}
                    >
                      <Picker.Item label="Not set" value="__none__" />
                      {options.map((option) => (
                        <Picker.Item key={option} label={option} value={option} />
                      ))}
                    </Picker>
                  </View>
                </View>
              );
            }

            if (field.type === "multiselect") {
              const options = normalizeSelectOptions(field.options);
              const selectedValues = Array.isArray(customValues[field.slot])
                ? (customValues[field.slot] as string[])
                : [];
              return (
                <View key={field.slot} style={styles.fieldWrap}>
                  <Text style={styles.label}>{field.name}</Text>
                  {options.length > 0 ? (
                    <View style={styles.multiselectWrap}>
                      {options.map((option) => {
                        const isSelected = selectedValues.includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.multiselectChip, isSelected && styles.multiselectChipSelected]}
                            onPress={() => toggleMultiValue(field.slot, option)}
                            disabled={isSaving}
                          >
                            <Text
                              style={[
                                styles.multiselectChipText,
                                isSelected && styles.multiselectChipTextSelected,
                              ]}
                            >
                              {option}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.mutedText}>No options configured</Text>
                  )}
                </View>
              );
            }

            const isNumber = field.type === "number";
            return (
              <View key={field.slot} style={styles.fieldWrap}>
                <Text style={styles.label}>{field.name}</Text>
                <TextInput
                  style={styles.input}
                  value={(customValues[field.slot] as string | undefined) ?? ""}
                  onChangeText={(value) => setCustomValue(field.slot, value)}
                  keyboardType={isNumber ? "numeric" : "default"}
                  placeholder={isNumber ? "0" : "Enter value"}
                  editable={!isSaving}
                />
              </View>
            );
          })}
        </View>

        {submitError && (
          <View style={styles.section}>
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} disabled={isSaving}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: primaryColor }, isSaving && styles.disabled]}
          onPress={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Add person</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: "#111827",
    backgroundColor: "#fff",
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  booleanRow: {
    flexDirection: "row",
    gap: 8,
  },
  booleanButton: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  booleanSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  booleanText: {
    fontSize: 12,
    color: "#1F2937",
    fontWeight: "600",
  },
  multiselectWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  multiselectChip: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  multiselectChipSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  multiselectChipText: {
    fontSize: 12,
    color: "#374151",
  },
  multiselectChipTextSelected: {
    color: "#1D4ED8",
    fontWeight: "600",
  },
  mutedText: {
    fontSize: 12,
    color: "#6B7280",
  },
  errorText: {
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    padding: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "600",
  },
  primaryButton: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.6,
  },
});

