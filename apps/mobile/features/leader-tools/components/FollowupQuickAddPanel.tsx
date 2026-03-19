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
import { useTheme } from "@hooks/useTheme";

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
  const { colors, isDark } = useTheme();
  const quickAddRow = useAuthenticatedMutation(api.functions.memberFollowups.quickAddRow);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("__none__");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
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
        assigneeIds: assigneeIds.length > 0 ? (assigneeIds as Id<"users">[]) : undefined,
        customFieldValues,
      });

      Alert.alert("Person added", "They were added to the group and people list.");
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
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Add person</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Required</Text>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>First name *</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
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
            <Text style={[styles.label, { color: colors.textSecondary }]}>Phone *</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
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
          {validationError && <Text style={[styles.errorText, { color: colors.error }]}>{validationError}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile</Text>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Last name</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>ZIP code</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
              value={zipCode}
              onChangeText={setZipCode}
              placeholder="ZIP code"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Birthday</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              editable={!isSaving}
            />
          </View>
          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              placeholderTextColor={colors.inputPlaceholder}
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
          <Text style={[styles.sectionTitle, { color: colors.text }]}>People fields</Text>

          <View style={styles.fieldWrap}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Status</Text>
            <View style={[styles.pickerWrap, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
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
            <Text style={[styles.label, { color: colors.textSecondary }]}>Assignees</Text>
            <View style={styles.multiselectWrap}>
              {leaderOptions.map((leader) => {
                const id = leader.id;
                const isSelected = assigneeIds.includes(id);
                return (
                  <TouchableOpacity
                    key={id}
                    style={[styles.multiselectChip, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }, isSelected && { borderColor: primaryColor, backgroundColor: colors.selectedBackground }]}
                    onPress={() => {
                      setAssigneeIds((prev) =>
                        prev.includes(id) ? prev.filter((assigneeId) => assigneeId !== id) : [...prev, id]
                      );
                    }}
                    disabled={isSaving}
                  >
                    <Text
                      style={[
                        styles.multiselectChipText,
                        { color: colors.textSecondary },
                        isSelected && { color: primaryColor, fontWeight: "600" },
                      ]}
                    >
                      {`${leader.firstName} ${leader.lastName}`.trim()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {sortedCustomFields.map((field) => {
            if (field.type === "boolean") {
              const selectedValue = customValues[field.slot] as boolean | undefined;
              return (
                <View key={field.slot} style={styles.fieldWrap}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{field.name}</Text>
                  <View style={styles.booleanRow}>
                    <TouchableOpacity
                      style={[styles.booleanButton, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }, selectedValue === undefined && { borderColor: primaryColor, backgroundColor: colors.selectedBackground }]}
                      onPress={() => setCustomValue(field.slot, undefined)}
                      disabled={isSaving}
                    >
                      <Text style={[styles.booleanText, { color: colors.text }]}>Not set</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.booleanButton, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }, selectedValue === true && { borderColor: primaryColor, backgroundColor: colors.selectedBackground }]}
                      onPress={() => setCustomValue(field.slot, true)}
                      disabled={isSaving}
                    >
                      <Text style={[styles.booleanText, { color: colors.text }]}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.booleanButton, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }, selectedValue === false && { borderColor: primaryColor, backgroundColor: colors.selectedBackground }]}
                      onPress={() => setCustomValue(field.slot, false)}
                      disabled={isSaving}
                    >
                      <Text style={[styles.booleanText, { color: colors.text }]}>No</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            if (field.type === "dropdown") {
              const options = normalizeSelectOptions(field.options);
              return (
                <View key={field.slot} style={styles.fieldWrap}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{field.name}</Text>
                  <View style={[styles.pickerWrap, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
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
                  <Text style={[styles.label, { color: colors.textSecondary }]}>{field.name}</Text>
                  {options.length > 0 ? (
                    <View style={styles.multiselectWrap}>
                      {options.map((option) => {
                        const isSelected = selectedValues.includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.multiselectChip, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }, isSelected && { borderColor: primaryColor, backgroundColor: colors.selectedBackground }]}
                            onPress={() => toggleMultiValue(field.slot, option)}
                            disabled={isSaving}
                          >
                            <Text
                              style={[
                                styles.multiselectChipText,
                                { color: colors.textSecondary },
                                isSelected && { color: primaryColor, fontWeight: "600" },
                              ]}
                            >
                              {option}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.mutedText, { color: colors.textTertiary }]}>No options configured</Text>
                  )}
                </View>
              );
            }

            const isNumber = field.type === "number";
            return (
              <View key={field.slot} style={styles.fieldWrap}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>{field.name}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  placeholderTextColor={colors.inputPlaceholder}
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
            <Text style={[styles.errorText, { color: colors.error }]}>{submitError}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={onCancel} disabled={isSaving}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: primaryColor }, isSaving && styles.disabled]}
          onPress={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: '#fff' }]}>Add person</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
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
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  pickerWrap: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  booleanRow: {
    flexDirection: "row",
    gap: 8,
  },
  booleanButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  booleanText: {
    fontSize: 12,
    fontWeight: "600",
  },
  multiselectWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  multiselectChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  multiselectChipText: {
    fontSize: 12,
  },
  mutedText: {
    fontSize: 12,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
  },
  footer: {
    borderTopWidth: 1,
    padding: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.6,
  },
});

