"use client";

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useAction, api } from "@services/api/convex";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DOMAIN_CONFIG } from "@togather/shared";
import { validateZipCode, normalizeZipCode } from "@features/groups/utils/geocodeLocation";

type FormField = {
  slot?: string;
  label: string;
  type: string;
  placeholder?: string;
  options?: string[];
  required: boolean;
  order: number;
  includeInNotes?: boolean;
};

export default function CommunityLandingPageClient() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();

  // Fetch landing page config
  const data = useQuery(
    api.functions.communityLandingPage.getBySlug,
    slug ? { slug } : "skip"
  );

  const submitFormAction = useAction(
    api.functions.communityLandingPageActions.submitForm
  );

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, any>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isLoading = data === undefined;
  const notFound = data === null;

  const primaryColor = data?.community?.primaryColor || DEFAULT_PRIMARY_COLOR;

  const updateCustomField = (fieldKey: string, value: any) => {
    setCustomFieldValues((prev) => ({ ...prev, [fieldKey]: value }));
  };

  // Format birthday input as MM/DD/YYYY with auto-slashes
  const handleBirthdayChange = (text: string) => {
    const cleaned = text.replace(/\D/g, "");
    let formatted = "";
    if (cleaned.length > 0) {
      formatted = cleaned.substring(0, 2);
    }
    if (cleaned.length > 2) {
      formatted += "/" + cleaned.substring(2, 4);
    }
    if (cleaned.length > 4) {
      formatted += "/" + cleaned.substring(4, 8);
    }
    setDateOfBirth(formatted);
  };

  // Validate birthday string (MM/DD/YYYY) and return ISO date or error
  const validateBirthday = (dateStr: string): { valid: boolean; isoDate?: string; error?: string } => {
    if (!dateStr.trim()) return { valid: true }; // optional field

    const parts = dateStr.split("/");
    if (parts.length !== 3 || parts[2].length !== 4) {
      return { valid: false, error: "Please enter a valid date (MM/DD/YYYY)" };
    }

    const [month, day, year] = parts.map(Number);
    if (!month || !day || !year) {
      return { valid: false, error: "Please enter a valid date (MM/DD/YYYY)" };
    }
    if (month < 1 || month > 12) {
      return { valid: false, error: "Month must be between 1 and 12" };
    }
    if (day < 1 || day > 31) {
      return { valid: false, error: "Day must be between 1 and 31" };
    }
    if (year < 1900 || year > new Date().getFullYear()) {
      return { valid: false, error: "Please enter a valid year" };
    }

    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      return { valid: false, error: "Please enter a valid date" };
    }

    // Birthday must not be in the future
    if (date > new Date()) {
      return { valid: false, error: "Birthday cannot be in the future" };
    }

    // Convert to YYYY-MM-DD for backend
    const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { valid: true, isoDate };
  };

  const handleSubmit = async () => {
    if (!slug || !data) return;

    // Validate required fields
    if (!firstName.trim()) {
      setSubmitError("First name is required");
      return;
    }
    if (!lastName.trim()) {
      setSubmitError("Last name is required");
      return;
    }
    if (!phone.trim()) {
      setSubmitError("Phone number is required");
      return;
    }

    // Validate ZIP code
    if (data.requireZipCode && !zipCode.trim()) {
      setSubmitError("ZIP code is required");
      return;
    }
    if (zipCode.trim()) {
      const zipResult = validateZipCode(zipCode.trim());
      if (!zipResult.isValid) {
        setSubmitError(zipResult.error || "Please enter a valid ZIP code");
        return;
      }
    }

    // Validate birthday
    if (data.requireBirthday && !dateOfBirth.trim()) {
      setSubmitError("Birthday is required");
      return;
    }
    const birthdayResult = validateBirthday(dateOfBirth);
    if (!birthdayResult.valid) {
      setSubmitError(birthdayResult.error || "Please enter a valid birthday");
      return;
    }

    // Validate required custom fields
    for (const field of data.formFields || []) {
      if (field.type === "section_header" || field.type === "subtitle") continue;
      if (field.required) {
        const key = field.slot || field.label;
        const value = customFieldValues[key];
        // For boolean fields, "required" means it must be checked (true)
        if (field.type === "boolean") {
          if (value !== true) {
            setSubmitError(`${field.label} must be checked`);
            return;
          }
        } else if (field.type === "multiselect") {
          if (!Array.isArray(value) || value.length === 0) {
            setSubmitError(`${field.label} is required`);
            return;
          }
        } else if (value === undefined || value === null || value === "") {
          setSubmitError(`${field.label} is required`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Build custom fields array — only include fields the user actually filled in
      const customFields = (data.formFields || [])
        .filter((field) => {
          if (field.type === "section_header" || field.type === "subtitle") return false;
          const key = field.slot || field.label;
          const rawValue = customFieldValues[key];

          // Always include required fields (they've been validated above)
          if (field.required) return true;

          // For optional fields, only include if user provided a non-default value
          if (field.type === "boolean") {
            return rawValue === true;
          } else if (field.type === "multiselect") {
            return Array.isArray(rawValue) && rawValue.length > 0;
          } else if (field.type === "number") {
            return rawValue !== undefined && rawValue !== "" && rawValue !== 0;
          } else {
            return rawValue !== undefined && rawValue !== null && rawValue !== "";
          }
        })
        .map((field) => {
          const key = field.slot || field.label;
          const rawValue = customFieldValues[key];
          let value: string | number | boolean;
          if (field.type === "boolean") {
            value = rawValue ?? false;
          } else if (field.type === "number") {
            value = rawValue !== undefined && rawValue !== "" ? Number(rawValue) : 0;
          } else if (field.type === "multiselect") {
            value = Array.isArray(rawValue) ? rawValue.join("; ") : (rawValue ?? "");
          } else {
            value = rawValue ?? "";
          }
          return {
            slot: field.slot || undefined,
            label: field.label,
            value,
            includeInNotes: field.includeInNotes ?? true,
          };
        });

      const normalizedZip = normalizeZipCode(zipCode.trim());

      await submitFormAction({
        slug,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        zipCode: normalizedZip || undefined,
        dateOfBirth: birthdayResult.isoDate || undefined,
        customFields,
      });

      setSubmitSuccess(true);
    } catch (error: any) {
      setSubmitError(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================================================
  // Render States
  // ============================================================================

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#999" />
        <Text style={styles.errorTitle}>Page Not Found</Text>
        <Text style={styles.errorText}>
          This community page doesn't exist or is no longer available.
        </Text>
      </SafeAreaView>
    );
  }

  if (submitSuccess) {
    return (
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: "#fff" }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: primaryColor + "15" }]}>
            <Ionicons name="checkmark-circle" size={64} color={primaryColor} />
          </View>
          <Text style={styles.successTitle}>
            {data.successMessage || `Welcome to ${data.community?.name || "the community"}!`}
          </Text>
          <Text style={styles.successSubtitle}>
            Download the Togather app to stay connected.
          </Text>
          <View style={styles.appLinksContainer}>
            <TouchableOpacity
              style={[styles.appStoreButton, { backgroundColor: primaryColor }]}
              onPress={() => {
                if (Platform.OS === "web") {
                  window.open(
                    "https://apps.apple.com/us/app/togather-life-in-community/id6756286011",
                    "_blank"
                  );
                }
              }}
            >
              <Ionicons name="logo-apple" size={20} color="#fff" />
              <Text style={styles.appStoreButtonText}>App Store</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.appStoreButton, { backgroundColor: primaryColor }]}
              onPress={() => {
                if (Platform.OS === "web") {
                  window.open(
                    `${DOMAIN_CONFIG.appUrl}/android`,
                    "_blank"
                  );
                }
              }}
            >
              <Ionicons name="logo-android" size={20} color="#fff" />
              <Text style={styles.appStoreButtonText}>Android APK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // Main Form
  // ============================================================================

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Section */}
          <View style={[styles.heroSection, { backgroundColor: primaryColor }]}>
            <View style={{ paddingTop: insets.top + 16 }} />
            {data.community?.logo ? (
              <AppImage
                source={data.community.logo}
                style={styles.communityLogo}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Ionicons name="people" size={48} color="#fff" />
              </View>
            )}
            <Text style={styles.heroTitle}>
              {data.title || data.community?.name || "Welcome"}
            </Text>
            {data.description && (
              <Text style={styles.heroDescription}>{data.description}</Text>
            )}
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            {/* Built-in fields */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>
                  First Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor="#aaa"
                  autoCapitalize="words"
                  autoComplete="given-name"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>
                  Last Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor="#aaa"
                  autoCapitalize="words"
                  autoComplete="family-name"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Phone <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.textInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="(555) 555-5555"
                placeholderTextColor="#aaa"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={setEmail}
                placeholder="email@example.com"
                placeholderTextColor="#aaa"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>
                  ZIP Code{data.requireZipCode ? <Text style={styles.required}> *</Text> : null}
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={zipCode}
                  onChangeText={setZipCode}
                  placeholder="10001"
                  placeholderTextColor="#aaa"
                  keyboardType="number-pad"
                  autoComplete="postal-code"
                  maxLength={10}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>
                  Birthday{data.requireBirthday ? <Text style={styles.required}> *</Text> : null}
                </Text>
                <TextInput
                  style={styles.textInput}
                  value={dateOfBirth}
                  onChangeText={handleBirthdayChange}
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor="#aaa"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>

            {/* Dynamic custom fields */}
            {[...(data.formFields || [])]
              .sort((a, b) => a.order - b.order)
              .map((field, index) => (
                <DynamicField
                  key={field.slot || field.label || index}
                  field={field}
                  value={customFieldValues[field.slot || field.label]}
                  onChange={(value) =>
                    updateCustomField(field.slot || field.label, value)
                  }
                />
              ))}

            {/* Error message */}
            {submitError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorBannerText}>{submitError}</Text>
              </View>
            )}

            {/* Submit button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: primaryColor },
                isSubmitting && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {data.submitButtonText || "Join"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <Text style={styles.footerText}>
            Powered by{" "}
            <Text style={{ fontWeight: "600" }}>{DOMAIN_CONFIG.brandName}</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ============================================================================
// Dynamic Field Component
// ============================================================================

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
}) {
  switch (field.type) {
    case "section_header":
      return (
        <View style={styles.sectionHeaderField}>
          <Text style={styles.sectionHeaderText}>{field.label}</Text>
        </View>
      );

    case "subtitle":
      return (
        <View style={styles.subtitleField}>
          <Text style={styles.subtitleText}>{field.label}</Text>
        </View>
      );

    case "boolean":
      return (
        <TouchableOpacity
          style={styles.booleanField}
          onPress={() => onChange(!value)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, !!value && styles.checkboxChecked]}>
            {!!value && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
          <Text style={styles.booleanLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
        </TouchableOpacity>
      );

    case "number":
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
          <TextInput
            style={styles.textInput}
            value={value !== undefined ? String(value) : ""}
            onChangeText={(text) => {
              const num = parseFloat(text);
              onChange(isNaN(num) ? undefined : num);
            }}
            keyboardType="numeric"
            placeholder={field.placeholder}
            placeholderTextColor="#aaa"
          />
        </View>
      );

    case "dropdown":
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
          <View style={styles.dropdownContainer}>
            {(field.options || []).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.dropdownOption,
                  value === option && styles.dropdownOptionSelected,
                ]}
                onPress={() => onChange(option)}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    value === option && styles.dropdownOptionTextSelected,
                  ]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );

    case "multiselect": {
      const selectedValues: string[] = Array.isArray(value) ? value : [];
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
          <View style={styles.multiselectContainer}>
            {(field.options || []).map((option) => {
              const isChecked = selectedValues.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.multiselectOption,
                    isChecked && styles.multiselectOptionSelected,
                  ]}
                  onPress={() => {
                    const newValues = isChecked
                      ? selectedValues.filter((v) => v !== option)
                      : [...selectedValues, option];
                    onChange(newValues);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={20}
                    color={isChecked ? "#4CAF50" : "#999"}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={[
                      styles.multiselectOptionText,
                      isChecked && styles.multiselectOptionTextSelected,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    case "text":
    default:
      return (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
          <TextInput
            style={styles.textInput}
            value={value || ""}
            onChangeText={onChange}
            placeholder={field.placeholder}
            placeholderTextColor="#aaa"
          />
        </View>
      );
  }
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#333",
    marginTop: 16,
  },
  errorText: {
    fontSize: 15,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
  },

  // Hero
  heroSection: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  communityLogo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  heroDescription: {
    fontSize: 16,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    marginTop: 8,
    maxWidth: 400,
    lineHeight: 22,
  },

  // Form card
  formCard: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginTop: -24,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  fieldHalf: {
    flex: 1,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  required: {
    color: "#dc2626",
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fafafa",
  },

  // Boolean field (checkbox)
  booleanField: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  checkboxChecked: {
    backgroundColor: "#4CAF50",
    borderColor: "#4CAF50",
  },
  booleanLabel: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },

  // Dropdown
  dropdownContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dropdownOption: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#fafafa",
  },
  dropdownOptionSelected: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E9",
  },
  dropdownOptionText: {
    fontSize: 14,
    color: "#666",
  },
  dropdownOptionTextSelected: {
    color: "#2E7D32",
    fontWeight: "600",
  },

  // Multiselect (checkbox group)
  multiselectContainer: {
    gap: 6,
  },
  multiselectOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fafafa",
  },
  multiselectOptionSelected: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E9",
  },
  multiselectOptionText: {
    fontSize: 14,
    color: "#666",
  },
  multiselectOptionTextSelected: {
    color: "#2E7D32",
    fontWeight: "600",
  },

  // Section header & subtitle (decorative fields)
  sectionHeaderField: {
    marginTop: 24,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  subtitleField: {
    marginBottom: 12,
  },
  subtitleText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    fontSize: 14,
    color: "#dc2626",
    flex: 1,
  },

  // Submit button
  submitButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Success
  successContainer: {
    alignItems: "center",
    padding: 24,
    maxWidth: 400,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  appLinksContainer: {
    flexDirection: "row",
    gap: 12,
  },
  appStoreButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  appStoreButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Footer
  footerText: {
    textAlign: "center",
    color: "#999",
    fontSize: 13,
    marginTop: 24,
    marginBottom: 16,
  },
});
