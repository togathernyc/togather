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
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  useQuery,
  useAction,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";
import { DOMAIN_CONFIG } from "@togather/shared";
import { validateZipCode, normalizeZipCode } from "@features/groups/utils/geocodeLocation";
import {
  isFieldVisibleOnLanding,
  parseSubtitleSegments,
  shouldCollectFieldResponse,
} from "./landingFieldUtils";

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

const openExternalUrl = async (url: string) => {
  if (!url) return;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
};

/** Fields the camera autofill returns from the connect-card photo. */
type ExtractedFields = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  zipCode?: string;
  dateOfBirth?: string;
  customFields?: Array<{ label: string; value: string }>;
};

/**
 * Coerce a string the model read off the card into the value shape a given
 * custom field expects. Returns undefined when the value can't be applied
 * (e.g. a dropdown value that doesn't match any option) so we never set junk.
 */
function coerceCustomFieldValue(
  field: FormField,
  rawValue: string
): string | number | boolean | string[] | undefined {
  const value = rawValue.trim();
  if (!value) return undefined;

  switch (field.type) {
    case "boolean": {
      const truthy = ["true", "yes", "y", "1", "checked", "x"].includes(
        value.toLowerCase()
      );
      // Only check the box on an affirmative read; never uncheck.
      return truthy ? true : undefined;
    }
    case "number": {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    }
    case "dropdown": {
      return (field.options || []).find(
        (o) => o.toLowerCase() === value.toLowerCase()
      );
    }
    case "multiselect": {
      const parts = value
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const matched = parts
        .map((p) =>
          (field.options || []).find((o) => o.toLowerCase() === p.toLowerCase())
        )
        .filter((o): o is string => !!o);
      return matched.length > 0 ? matched : undefined;
    }
    default:
      return value;
  }
}

/** Load an image element from a data URL (web only). */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Keep the uploaded image small. expo-image-picker compresses via `quality` on
 * native, but on web it returns the original file, so a phone photo can be many
 * MB. Downscale large web images with a canvas before sending to the action.
 */
async function prepareImageForUpload(
  base64: string,
  mimeType: string
): Promise<{ base64: string; mimeType: string }> {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return { base64, mimeType };
  }
  try {
    const img = await loadImageElement(`data:${mimeType};base64,${base64}`);
    const MAX_EDGE = 1600;
    const longest = Math.max(img.width, img.height);
    if (longest <= MAX_EDGE) return { base64, mimeType };

    const scale = MAX_EDGE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { base64, mimeType };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const comma = dataUrl.indexOf(",");
    if (comma === -1) return { base64, mimeType };
    return { base64: dataUrl.slice(comma + 1), mimeType: "image/jpeg" };
  } catch {
    return { base64, mimeType };
  }
}

export default function CommunityLandingPageClient() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
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

  // Admin-only camera autofill: photograph a paper connect card and let the
  // backend OCR it to pre-fill the form (the admin still reviews + submits).
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const extractFormFromImage = useAuthenticatedAction(
    api.functions.communityLandingPageActions.extractFormFromImage
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [autofillNotice, setAutofillNotice] = useState<string | null>(null);

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

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/search");
    }
  };

  const primaryColor = data?.community?.primaryColor || DEFAULT_PRIMARY_COLOR;
  const visibleFormFields = [...(data?.formFields || [])]
    .filter((field) => isFieldVisibleOnLanding(field))
    .sort((a, b) => a.order - b.order);

  const updateCustomField = (fieldKey: string, value: any) => {
    setCustomFieldValues((prev) => ({ ...prev, [fieldKey]: value }));
  };

  // Apply extracted values to the form. Only fills fields we actually read;
  // never clears anything the admin already typed for an unread field.
  const applyExtractedFields = (extracted: ExtractedFields) => {
    let filled = 0;
    if (extracted.firstName) {
      setFirstName(extracted.firstName);
      filled++;
    }
    if (extracted.lastName) {
      setLastName(extracted.lastName);
      filled++;
    }
    if (extracted.phone) {
      setPhone(extracted.phone);
      filled++;
    }
    if (extracted.email) {
      setEmail(extracted.email);
      filled++;
    }
    if (extracted.zipCode) {
      setZipCode(extracted.zipCode);
      filled++;
    }
    if (extracted.dateOfBirth) {
      setDateOfBirth(extracted.dateOfBirth);
      filled++;
    }

    if (extracted.customFields?.length) {
      const updates: Record<string, string | number | boolean | string[]> = {};
      for (const { label, value } of extracted.customFields) {
        const field = visibleFormFields.find(
          (f) => f.label === label && shouldCollectFieldResponse(f)
        );
        if (!field) continue;
        const coerced = coerceCustomFieldValue(field, value);
        if (coerced !== undefined) {
          updates[field.slot || field.label] = coerced;
          filled++;
        }
      }
      if (Object.keys(updates).length > 0) {
        setCustomFieldValues((prev) => ({ ...prev, ...updates }));
      }
    }

    setSubmitError(null);
    setAutofillNotice(
      filled > 0
        ? "Fields autofilled from your photo. Please review everything before submitting."
        : "We couldn't read any fields from that photo. Try a clearer picture or enter the details manually."
    );
  };

  // Pick/take a photo of a connect card and autofill the form from it.
  const handleAutofillFromPhoto = async () => {
    if (!slug || !data || isExtracting) return;
    try {
      // Native needs library permission; web uses a file input (no prompt).
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setSubmitError(
            "Photo access is required to autofill from a photo. Please enable it in settings."
          );
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.5,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]?.base64) return;

      setIsExtracting(true);
      setSubmitError(null);
      setAutofillNotice(null);

      const asset = result.assets[0];
      const { base64, mimeType } = await prepareImageForUpload(
        asset.base64 as string,
        asset.mimeType ?? "image/jpeg"
      );

      const customFields = visibleFormFields
        .filter((f) => shouldCollectFieldResponse(f))
        .map((f) => ({
          slot: f.slot || undefined,
          label: f.label,
          type: f.type,
          options: f.options,
        }));

      const extracted = await extractFormFromImage({
        slug,
        imageBase64: base64,
        mimeType,
        customFields,
      });

      applyExtractedFields(extracted);
    } catch (error: any) {
      setSubmitError(
        error?.message ||
          "Couldn't autofill from that photo. Please try again or enter the details manually."
      );
    } finally {
      setIsExtracting(false);
    }
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
    for (const field of visibleFormFields) {
      if (!shouldCollectFieldResponse(field)) continue;
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
      const customFields = visibleFormFields
        .filter((field) => {
          if (!shouldCollectFieldResponse(field)) return false;
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
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <View style={styles.closeButtonRow}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <View style={styles.closeButtonRow}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.textTertiary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Page Not Found</Text>
          <Text style={[styles.errorText, { color: colors.textTertiary }]}>
            This community page doesn't exist or is no longer available.
          </Text>
          <TouchableOpacity
            style={[styles.backButton, { borderColor: colors.border }]}
            onPress={handleClose}
          >
            <Text style={[styles.backButtonText, { color: colors.text }]}>Go to Explore</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (submitSuccess) {
    return (
      <SafeAreaView style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <View style={styles.closeButtonRow}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContent}>
          <View style={styles.successContainer}>
            <View style={[styles.successIcon, { backgroundColor: primaryColor + "15" }]}>
              <Ionicons name="checkmark-circle" size={64} color={primaryColor} />
            </View>
            <Text style={[styles.successTitle, { color: colors.text }]}>
              {data.successMessage || `Welcome to ${data.community?.name || "the community"}!`}
            </Text>
            <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
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
              <Text style={styles.appStoreButtonText}>Join Android testers</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // Main Form
  // ============================================================================

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
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
            <View style={[styles.heroCloseRow, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity style={styles.heroCloseButton} onPress={handleClose}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity
                  style={styles.heroCameraButton}
                  onPress={handleAutofillFromPhoto}
                  disabled={isExtracting}
                  accessibilityRole="button"
                  accessibilityLabel="Autofill form from a photo"
                >
                  {isExtracting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="camera" size={22} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
            </View>
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
          <View style={[styles.formCard, { backgroundColor: colors.surface }]}>
            {/* Admin autofill notice */}
            {autofillNotice && (
              <View
                style={[
                  styles.autofillBanner,
                  { backgroundColor: primaryColor + "15" },
                ]}
              >
                <Ionicons name="sparkles" size={16} color={primaryColor} />
                <Text style={[styles.autofillBannerText, { color: colors.text }]}>
                  {autofillNotice}
                </Text>
              </View>
            )}

            {/* Built-in fields */}
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>
                  First Name <Text style={[styles.required, { color: colors.error }]}>*</Text>
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor={colors.inputPlaceholder}
                  autoCapitalize="words"
                  autoComplete="given-name"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>
                  Last Name <Text style={[styles.required, { color: colors.error }]}>*</Text>
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor={colors.inputPlaceholder}
                  autoCapitalize="words"
                  autoComplete="family-name"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                Phone <Text style={[styles.required, { color: colors.error }]}>*</Text>
              </Text>
              <TextInput
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="(555) 555-5555"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Email</Text>
              <TextInput
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                value={email}
                onChangeText={setEmail}
                placeholder="email@example.com"
                placeholderTextColor={colors.inputPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>
                  ZIP Code{data.requireZipCode ? <Text style={[styles.required, { color: colors.error }]}> *</Text> : null}
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={zipCode}
                  onChangeText={setZipCode}
                  placeholder="10001"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                  autoComplete="postal-code"
                  maxLength={10}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>
                  Birthday{data.requireBirthday ? <Text style={[styles.required, { color: colors.error }]}> *</Text> : null}
                </Text>
                <TextInput
                  style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
                  value={dateOfBirth}
                  onChangeText={handleBirthdayChange}
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor={colors.inputPlaceholder}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>

            {/* Dynamic custom fields */}
            {visibleFormFields.map((field, index) => (
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
              <View style={[styles.errorBanner, { backgroundColor: isDark ? 'rgba(255,59,48,0.15)' : '#FEF2F2' }]}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={[styles.errorBannerText, { color: colors.error }]}>{submitError}</Text>
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
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
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
  const { colors, isDark } = useTheme();
  const subtitleSegments =
    field.type === "subtitle" ? parseSubtitleSegments(field.label) : [];

  switch (field.type) {
    case "section_header":
      return (
        <View style={[styles.sectionHeaderField, { borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.sectionHeaderText, { color: colors.text }]}>{field.label}</Text>
        </View>
      );

    case "subtitle":
      return (
        <View style={styles.subtitleField}>
          <Text style={[styles.subtitleText, { color: colors.textSecondary }]}>
            {subtitleSegments.map((segment, idx) =>
              segment.type === "link" ? (
                <Text
                  key={`${segment.url}-${idx}`}
                  style={[styles.subtitleLink, { color: colors.link }]}
                  onPress={() => openExternalUrl(segment.url)}
                  suppressHighlighting
                >
                  {segment.text}
                </Text>
              ) : (
                <Text key={`${segment.text}-${idx}`}>{segment.text}</Text>
              )
            )}
          </Text>
        </View>
      );

    case "button":
      return (
        <View style={styles.field}>
          <TouchableOpacity
            style={[styles.fullWidthButton, { backgroundColor: colors.link }]}
            onPress={() => {
              if (field.buttonUrl) {
                openExternalUrl(field.buttonUrl);
              }
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.fullWidthButtonText}>{field.label}</Text>
          </TouchableOpacity>
        </View>
      );

    case "boolean":
      return (
        <TouchableOpacity
          style={styles.booleanField}
          onPress={() => onChange(!value)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, { borderColor: colors.border, backgroundColor: colors.inputBackground }, !!value && { backgroundColor: colors.success, borderColor: colors.success }]}>
            {!!value && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
          <Text style={[styles.booleanLabel, { color: colors.text }]}>
            {field.label}
            {field.required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
          </Text>
        </TouchableOpacity>
      );

    case "number":
      return (
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>
            {field.label}
            {field.required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
          </Text>
          <TextInput
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={value !== undefined ? String(value) : ""}
            onChangeText={(text) => {
              const num = parseFloat(text);
              onChange(isNaN(num) ? undefined : num);
            }}
            keyboardType="numeric"
            placeholder={field.placeholder}
            placeholderTextColor={colors.inputPlaceholder}
          />
        </View>
      );

    case "dropdown":
      return (
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>
            {field.label}
            {field.required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
          </Text>
          <View style={styles.dropdownContainer}>
            {(field.options || []).map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.dropdownOption,
                  { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                  value === option && { borderColor: colors.success, backgroundColor: isDark ? 'rgba(52, 199, 89, 0.15)' : '#E8F5E9' },
                ]}
                onPress={() => onChange(option)}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    { color: colors.textSecondary },
                    value === option && { color: colors.success, fontWeight: '600' as const },
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
          <Text style={[styles.fieldLabel, { color: colors.text }]}>
            {field.label}
            {field.required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
          </Text>
          <View style={styles.multiselectContainer}>
            {(field.options || []).map((option) => {
              const isChecked = selectedValues.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.multiselectOption,
                    { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                    isChecked && { borderColor: colors.success, backgroundColor: isDark ? 'rgba(52, 199, 89, 0.15)' : '#E8F5E9' },
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
                    color={isChecked ? colors.success : colors.textTertiary}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={[
                      styles.multiselectOptionText,
                      { color: colors.textSecondary },
                      isChecked && { color: colors.success, fontWeight: '600' as const },
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
          <Text style={[styles.fieldLabel, { color: colors.text }]}>
            {field.label}
            {field.required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
          </Text>
          <TextInput
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            value={value || ""}
            onChangeText={onChange}
            placeholder={field.placeholder}
            placeholderTextColor={colors.inputPlaceholder}
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
  },
  closeButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(150, 150, 150, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 16,
  },
  errorText: {
    fontSize: 15,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 24,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },

  // Hero
  heroSection: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  heroCloseRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
  },
  heroCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroCameraButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    alignItems: "center",
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
    marginBottom: 6,
  },
  required: {},
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
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
    justifyContent: "center",
    alignItems: "center",
  },
  booleanLabel: {
    fontSize: 16,
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
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dropdownOptionText: {
    fontSize: 14,
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
  },
  multiselectOptionText: {
    fontSize: 14,
  },

  // Section header & subtitle (decorative fields)
  sectionHeaderField: {
    marginTop: 24,
    marginBottom: 8,
    borderBottomWidth: 1,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 18,
    fontWeight: "700",
  },
  subtitleField: {
    marginBottom: 12,
  },
  subtitleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  subtitleLink: {
    textDecorationLine: "underline",
  },

  fullWidthButton: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidthButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Admin autofill notice
  autofillBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  autofillBannerText: {
    fontSize: 14,
    flex: 1,
  },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    fontSize: 14,
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
    textAlign: "center",
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
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
    fontSize: 13,
    marginTop: 24,
    marginBottom: 16,
  },
});
