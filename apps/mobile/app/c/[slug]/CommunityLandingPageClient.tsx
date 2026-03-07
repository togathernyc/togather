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
  Switch,
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

type FormField = {
  slot?: string;
  label: string;
  type: string;
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

    // Validate required custom fields
    for (const field of data.formFields || []) {
      if (field.required) {
        const key = field.slot || field.label;
        const value = customFieldValues[key];
        if (value === undefined || value === null || value === "") {
          setSubmitError(`${field.label} is required`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Build custom fields array — filter out empty optional fields
      const customFields = (data.formFields || []).map((field) => {
        const key = field.slot || field.label;
        const rawValue = customFieldValues[key];
        let value: string | number | boolean;
        if (field.type === "boolean") {
          value = rawValue ?? false;
        } else if (field.type === "number") {
          value = rawValue !== undefined && rawValue !== "" ? Number(rawValue) : 0;
        } else {
          value = rawValue ?? "";
        }
        return {
          slot: field.slot || undefined,
          label: field.label,
          value,
        };
      });

      await submitFormAction({
        slug,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
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
                    "https://apps.apple.com/app/togather-community/id6738880626",
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
                    "https://play.google.com/store/apps/details?id=com.togather.app",
                    "_blank"
                  );
                }
              }}
            >
              <Ionicons name="logo-google-playstore" size={20} color="#fff" />
              <Text style={styles.appStoreButtonText}>Google Play</Text>
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
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
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
    case "boolean":
      return (
        <View style={styles.booleanField}>
          <Switch
            value={!!value}
            onValueChange={onChange}
            trackColor={{ false: "#ddd", true: "#4CAF50" }}
          />
          <Text style={styles.booleanLabel}>
            {field.label}
            {field.required && <Text style={styles.required}> *</Text>}
          </Text>
        </View>
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
            placeholder={field.label}
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
            placeholder={field.label}
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

  // Boolean field
  booleanField: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
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
