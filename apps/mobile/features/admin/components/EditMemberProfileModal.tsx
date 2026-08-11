/**
 * EditMemberProfileModal — admin correction of a member's profile (ADR-034).
 *
 * Exists for data entered on someone's behalf, typically typed off a paper
 * Gold Card after a service. Phone and email are sign-in credentials rather
 * than ordinary data, so the backend locks them on any account a person has
 * actually claimed or that carries authority; when it does, `lockedReason`
 * explains why and those two fields render read-only.
 *
 * The modal is presentational: the parent owns the mutation, `isSaving`, and
 * error reporting, matching GroupTypeEditModal.
 */
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input, DatePicker } from "@components/ui";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

/**
 * Values the admin may correct. `dateOfBirth` is the stored timestamp
 * (UTC midnight of the calendar day) or null.
 */
export interface EditableMemberProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: number | null;
}

/**
 * Only the fields the admin actually changed. Everything else is omitted so a
 * stale form can never revert another admin's concurrent correction — and so
 * the audit trail never records an untouched field as a deliberate edit.
 * `null` is an explicit clear.
 */
export interface MemberProfileEdits {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  reason?: string;
}

interface EditMemberProfileModalProps {
  visible: boolean;
  member: EditableMemberProfile | null;
  /** Non-null when the backend will refuse phone/email changes. */
  lockedReason: string | null;
  onClose: () => void;
  onSave: (edits: MemberProfileEdits) => Promise<void>;
  isSaving: boolean;
}

/**
 * Stored dateOfBirth (UTC midnight) → the Date the picker should display.
 *
 * The two converters here read different clocks ON PURPOSE, and the asymmetry
 * is the whole point: the STORED value is UTC midnight of the calendar day
 * (`new Date("YYYY-MM-DD")`, the convention `auth/helpers.parseAndValidateDate`
 * established), whereas the shared DatePicker deals in LOCAL wall-clock Dates
 * on every platform — its web branch builds `new Date(y, m - 1, d)` from local
 * parts precisely so the two platforms agree. Reading either one with the
 * other's getters shifts the birthday by a day, in one direction or the other
 * depending on the sign of the UTC offset.
 *
 * Note there is deliberately no `Platform.OS` branch: the picker's web and
 * native values mean the same thing, and branching would reintroduce the
 * off-by-one this avoids.
 */
function timestampToPickerDate(timestamp: number | null): Date | null {
  if (timestamp === null) return null;
  const stored = new Date(timestamp);
  return new Date(
    stored.getUTCFullYear(),
    stored.getUTCMonth(),
    stored.getUTCDate(),
  );
}

/** Picker Date (local wall-clock) → the YYYY-MM-DD the API expects. */
function pickerDateToISODate(date: Date | null): string | null {
  if (!date) return null;
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Stored timestamp → YYYY-MM-DD, for comparing against the picked value. */
function timestampToISODate(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const stored = new Date(timestamp);
  const year = String(stored.getUTCFullYear()).padStart(4, "0");
  const month = String(stored.getUTCMonth() + 1).padStart(2, "0");
  const day = String(stored.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function EditMemberProfileModal({
  visible,
  member,
  lockedReason,
  onClose,
  onSave,
  isSaving,
}: EditMemberProfileModalProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [reason, setReason] = useState("");

  // What the form opened with. Comparing against this is what makes the
  // submission dirty-field-only.
  const initialRef = useRef<EditableMemberProfile | null>(null);

  // Reset ONLY on the transition to open — never on `member` identity.
  //
  // The parent rebuilds its `member` object on every render, and a render is
  // guaranteed the moment saving starts. Depending on `member` here would
  // overwrite every field the admin typed the instant they hit Save, so a
  // backend rejection would leave the modal open with all their corrections
  // silently replaced by the old values and no indication why.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setFirstName(member?.firstName ?? "");
      setLastName(member?.lastName ?? "");
      setEmail(member?.email ?? "");
      setPhone(member?.phone ?? "");
      setDateOfBirth(timestampToPickerDate(member?.dateOfBirth ?? null));
      setReason("");
      initialRef.current = member;
    }
    wasVisible.current = visible;
  }, [visible, member]);

  const isLocked = lockedReason !== null;
  // An empty phone means "none on file", not "remove it" — migrated records
  // often have none, and requiring one to fix a name would be wrong. But an
  // existing number cannot be cleared, since it is how the member signs in.
  const hasStoredPhone = !!initialRef.current?.phone;

  const edits = useMemo<MemberProfileEdits>(() => {
    const initial = initialRef.current;
    if (!initial) return {};

    const result: MemberProfileEdits = {};

    if (firstName.trim() !== (initial.firstName ?? "").trim()) {
      result.firstName = firstName.trim();
    }
    if (lastName.trim() !== (initial.lastName ?? "").trim()) {
      result.lastName = lastName.trim();
    }

    // Locked contact fields are never submitted at all, so a legacy-format or
    // today-invalid stored value cannot trip a guard meant for real edits.
    if (!isLocked) {
      if (email.trim() !== (initial.email ?? "").trim()) {
        result.email = email.trim() || null;
      }
      if (phone.trim() !== (initial.phone ?? "").trim()) {
        result.phone = phone.trim() || null;
      }
    }

    const pickedISO = pickerDateToISODate(dateOfBirth);
    const initialISO = timestampToISODate(initial.dateOfBirth ?? null);
    if (pickedISO !== initialISO) {
      result.dateOfBirth = pickedISO;
    }

    if (reason.trim()) {
      result.reason = reason.trim();
    }

    return result;
  }, [firstName, lastName, email, phone, dateOfBirth, reason, isLocked]);

  const changedFieldCount = Object.keys(edits).filter(
    (k) => k !== "reason",
  ).length;

  const isValid =
    firstName.trim().length > 0 &&
    changedFieldCount > 0 &&
    reason.length <= 500 &&
    // Refuse to submit a removal the backend would reject anyway.
    !(hasStoredPhone && !isLocked && phone.trim().length === 0);

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    await onSave(edits);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <Pressable
            style={[styles.container, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>
                Edit Profile
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.form}>
                <Input
                  label="First name"
                  required
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                />

                <Input
                  label="Last name"
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                />

                {isLocked && (
                  <View style={styles.lockedBanner}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color="#E65100"
                    />
                    <Text style={styles.lockedText}>
                      Phone and email can&apos;t be changed here because{" "}
                      {lockedReason}. They&apos;re sign-in details, so only the
                      member can change them.
                    </Text>
                  </View>
                )}

                <Input
                  label="Phone"
                  required={hasStoredPhone && !isLocked}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={
                    hasStoredPhone ? "Phone number" : "No phone on file"
                  }
                  editable={!isLocked}
                  keyboardType="phone-pad"
                />

                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  editable={!isLocked}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <DatePicker
                  label="Date of birth"
                  value={dateOfBirth}
                  onChange={setDateOfBirth}
                  maximumDate={new Date()}
                  placeholder="Select a date"
                />
                {/*
                  The shared DatePicker only emits selected Dates on iOS and
                  Android — its clear affordance is the web <input>'s empty
                  value, which native has no equivalent for. Without this,
                  clearing a date of birth would work on web only.
                */}
                {dateOfBirth !== null && (
                  <TouchableOpacity
                    onPress={() => setDateOfBirth(null)}
                    style={styles.clearDateButton}
                  >
                    <Text style={[styles.clearDateText, { color: primaryColor }]}>
                      Clear date of birth
                    </Text>
                  </TouchableOpacity>
                )}

                <Input
                  label="Reason (optional)"
                  value={reason}
                  onChangeText={setReason}
                  placeholder="e.g. Corrected from Gold Card"
                  multiline
                  numberOfLines={2}
                  error={
                    reason.length > 500
                      ? "Reason must be 500 characters or fewer"
                      : undefined
                  }
                />
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  { backgroundColor: primaryColor },
                  (!isValid || isSaving) && styles.saveButtonDisabled,
                ]}
                onPress={handleSave}
                disabled={!isValid || isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  keyboardView: {
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    maxHeight: "90%",
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
    fontWeight: "600",
  },
  scroll: {
    flexGrow: 0,
  },
  form: {
    padding: 16,
  },
  lockedBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FFF3E0",
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
  },
  lockedText: {
    flex: 1,
    fontSize: 13,
    color: "#E65100",
    lineHeight: 18,
  },
  clearDateButton: {
    paddingVertical: 8,
    marginBottom: 16,
  },
  clearDateText: {
    fontSize: 14,
    fontWeight: "500",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  saveButton: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
