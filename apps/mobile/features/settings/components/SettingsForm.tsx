import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "@hooks/useTheme";
import { useSettings } from "../hooks/useSettings";
import { useUpdateSettings } from "../hooks/useUpdateSettings";
import { SettingsFormData } from "../types";

export function SettingsForm() {
  const { colors } = useTheme();
  const {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    isEditing,
    setIsEditing,
    resetForm,
    user,
  } = useSettings();
  const { updateSettings, isUpdating } = useUpdateSettings();

  const handleSave = () => {
    const data: SettingsFormData = {
      first_name: firstName,
      last_name: lastName,
    };
    updateSettings(data, {
      onSuccess: () => {
        setIsEditing(false);
      },
    });
  };

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Profile Information</Text>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>First Name</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
          value={firstName}
          onChangeText={setFirstName}
          editable={isEditing}
          placeholder="First name"
          placeholderTextColor={colors.inputPlaceholder}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Last Name</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
          value={lastName}
          onChangeText={setLastName}
          editable={isEditing}
          placeholder="Last name"
          placeholderTextColor={colors.inputPlaceholder}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
        <TextInput
          style={[styles.input, styles.inputDisabled, { borderColor: colors.inputBorder, backgroundColor: colors.surfaceSecondary, color: colors.textSecondary }]}
          value={user?.email || ""}
          editable={false}
          placeholder="Email"
          placeholderTextColor={colors.inputPlaceholder}
        />
      </View>

      {isEditing ? (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]}
            onPress={resetForm}
          >
            <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.saveButton, { backgroundColor: colors.link }]}
            onPress={handleSave}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.link }]}
          onPress={() => setIsEditing(true)}
        >
          <Text style={[styles.buttonText, { color: colors.textInverse }]}>Edit Profile</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 2,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  inputDisabled: {},
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
  },
  cancelButtonText: {},
  saveButton: {
    flex: 1,
  },
  saveButtonText: {},
});
