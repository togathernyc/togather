/**
 * SetupScreen - Community setup form accessed via email link after proposal acceptance.
 *
 * URL: /onboarding/setup?token=<setupToken>
 *
 * Flow:
 * 1. Read setup token from URL params
 * 2. Load proposal data via Convex query
 * 3. Show pre-filled form for community configuration
 * 4. On submit: complete setup -> create Stripe checkout -> redirect to Stripe
 */
import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useAction, api } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a community name into a URL-safe slug. */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Validate a slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens, min 2 chars. */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 2;
}

/** Validate a hex color string (#RRGGBB). */
function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

// ---------------------------------------------------------------------------
// Submission phases
// ---------------------------------------------------------------------------

type SubmissionPhase = "idle" | "setup" | "checkout" | "redirecting";

function getPhaseLabel(phase: SubmissionPhase): string {
  switch (phase) {
    case "setup":
      return "Saving community settings...";
    case "checkout":
      return "Creating checkout session...";
    case "redirecting":
      return "Redirecting to Stripe...";
    default:
      return "Continue to Payment";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColorInput({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const [textValue, setTextValue] = useState(value);
  const valid = isValidHex(textValue);

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  function handleTextChange(newValue: string) {
    let normalized = newValue;
    if (normalized && !normalized.startsWith("#")) {
      normalized = "#" + normalized;
    }
    setTextValue(normalized);
    if (isValidHex(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.colorRow}>
        {/* Native color picker on web */}
        {Platform.OS === "web" && (
          <View style={styles.colorPickerWrapper}>
            <input
              type="color"
              value={valid ? textValue : "#000000"}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e: any) => {
                const hex = (e.target as HTMLInputElement).value.toUpperCase();
                setTextValue(hex);
                onChange(hex);
              }}
              style={{
                width: 40,
                height: 40,
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                padding: 2,
                backgroundColor: "transparent",
              }}
            />
          </View>
        )}
        <TextInput
          style={[
            styles.input,
            styles.colorTextInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor:
                textValue && !valid ? colors.error : colors.inputBorder,
              color: colors.text,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            },
          ]}
          value={textValue}
          onChangeText={handleTextChange}
          placeholder="#3B82F6"
          placeholderTextColor={colors.inputPlaceholder}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {valid && (
          <View
            style={[styles.colorSwatch, { backgroundColor: textValue }]}
          />
        )}
      </View>
      {textValue && !valid && (
        <Text style={[styles.fieldHint, { color: colors.error }]}>
          Enter a valid hex color (e.g. #3B82F6)
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SetupScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // ---- Data loading ----
  const data = useQuery(
    api.functions.ee.proposals.getBySetupToken,
    token ? { setupToken: token } : "skip"
  );

  const completeSetup = useMutation(api.functions.ee.proposals.completeSetup);
  const createCheckoutSession = useAction(
    api.functions.ee.billing.createCheckoutSession
  );

  // ---- Form state ----
  const proposalName = data?.proposal?.communityName ?? "";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#1E293B");
  const [initialized, setInitialized] = useState(false);

  // ---- Submission state ----
  const [submitting, setSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] =
    useState<SubmissionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  // Pre-fill from proposal (once)
  if (proposalName && !initialized) {
    setName(proposalName);
    setSlug(nameToSlug(proposalName));
    setInitialized(true);
  }

  // Auto-generate slug from name unless manually edited
  const handleNameChange = useCallback(
    (newName: string) => {
      setName(newName);
      if (!slugManuallyEdited) {
        setSlug(nameToSlug(newName));
      }
    },
    [slugManuallyEdited]
  );

  const handleSlugChange = useCallback((newSlug: string) => {
    const sanitized = newSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-");
    setSlug(sanitized);
    setSlugManuallyEdited(true);
    setSlugError(null);
  }, []);

  // ---- Validation ----
  const slugValid = isValidSlug(slug);
  const primaryColorValid = isValidHex(primaryColor);
  const secondaryColorValid = isValidHex(secondaryColor);
  const formValid =
    name.trim().length > 0 &&
    slugValid &&
    primaryColorValid &&
    secondaryColorValid;

  // ---- Submit ----
  async function handleSubmit() {
    if (!token || !formValid || submitting) return;

    setError(null);
    setSlugError(null);
    setSubmitting(true);

    try {
      // Phase 1: Save community settings
      setSubmissionPhase("setup");
      await completeSetup({
        setupToken: token,
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        primaryColor,
        secondaryColor,
      });

      // Phase 2: Create Stripe checkout session
      setSubmissionPhase("checkout");
      const result = await createCheckoutSession({
        setupToken: token,
      });

      // Phase 3: Redirect to Stripe
      setSubmissionPhase("redirecting");
      if (Platform.OS === "web") {
        window.location.href = result.url;
      } else {
        await Linking.openURL(result.url);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";

      if (message.includes("Slug is already taken")) {
        setSlugError(
          "That URL slug is already taken. Please choose a different one."
        );
      } else if (message.includes("Setup has already been completed")) {
        setError(
          "This community has already been set up. If you need to make changes, please contact support."
        );
      } else {
        setError(message);
      }

      setSubmitting(false);
      setSubmissionPhase("idle");
    }
  }

  // ---- Navigate home ----
  function goHome() {
    if (Platform.OS === "web") {
      window.location.href = DOMAIN_CONFIG.landingUrl;
    } else {
      router.push("/");
    }
  }

  // ===========================================================================
  // Error / loading states
  // ===========================================================================

  // No token
  if (!token) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <ErrorCard
          colors={colors}
          title="Missing setup token"
          message="This page requires a valid setup link. Please check your email for the community setup invitation."
          onGoHome={goHome}
        />
      </PageContainer>
    );
  }

  // Loading
  if (data === undefined) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text
            style={[styles.loadingText, { color: colors.textSecondary }]}
          >
            Loading your community setup...
          </Text>
        </View>
      </PageContainer>
    );
  }

  // Not found / expired
  if (data === null) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <ErrorCard
          colors={colors}
          title="Setup link not found"
          message="This setup link is invalid or has expired. Please contact support if you believe this is an error."
          onGoHome={goHome}
        />
      </PageContainer>
    );
  }

  // Setup already completed with active subscription
  if (
    data.proposal.setupCompletedAt !== undefined &&
    data.proposal.stripeSubscriptionId
  ) {
    return (
      <PageContainer colors={colors} insets={insets}>
        <View style={styles.centeredContent}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: colors.success + "1A" },
            ]}
          >
            <Ionicons
              name="checkmark-circle"
              size={32}
              color={colors.success}
            />
          </View>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Setup Complete
          </Text>
          <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>
            {data.community?.name
              ? `This community has already been set up as "${data.community.name}".`
              : "This community has already been set up."}
            {" "}If you need to make changes, please contact support.
          </Text>
        </View>
      </PageContainer>
    );
  }

  // ===========================================================================
  // Setup form
  // ===========================================================================

  return (
    <PageContainer colors={colors} insets={insets}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.text }]}>
              Set up your community
            </Text>
            <Text
              style={[styles.subheading, { color: colors.textSecondary }]}
            >
              Configure your community's profile and branding, then continue to
              payment to go live.
            </Text>
          </View>

          {/* Community Details Section */}
          <View
            style={[
              styles.section,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderLight,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Community Details
            </Text>

            {/* Community Name */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Community name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
                value={name}
                onChangeText={handleNameChange}
                placeholder="My Community"
                placeholderTextColor={colors.inputPlaceholder}
              />
            </View>

            {/* URL Slug */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                URL slug
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor:
                      slugError || (slug && !slugValid)
                        ? colors.error
                        : colors.inputBorder,
                    color: colors.text,
                    fontFamily:
                      Platform.OS === "ios" ? "Menlo" : "monospace",
                  },
                ]}
                value={slug}
                onChangeText={handleSlugChange}
                placeholder="my-community"
                placeholderTextColor={colors.inputPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text
                style={[styles.fieldHint, { color: colors.textTertiary }]}
              >
                Your community will be at{" "}
                <Text style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>
                  {DOMAIN_CONFIG.baseDomain}/{slug || "your-slug"}
                </Text>
                {" "}and{" "}
                <Text style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>
                  {slug || "your-slug"}.{DOMAIN_CONFIG.baseDomain}
                </Text>
              </Text>
              {slugError && (
                <Text style={[styles.fieldHint, { color: colors.error }]}>
                  {slugError}
                </Text>
              )}
              {!slugError && slug && !slugValid && (
                <Text style={[styles.fieldHint, { color: colors.error }]}>
                  Slug must be at least 2 characters, lowercase letters,
                  numbers, and hyphens only.
                </Text>
              )}
            </View>

            {/* Description */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Description{" "}
                <Text style={{ color: colors.textTertiary }}>(optional)</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.inputBorder,
                    color: colors.text,
                  },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder="Tell people what your community is about..."
                placeholderTextColor={colors.inputPlaceholder}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Branding Section */}
          <View
            style={[
              styles.section,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderLight,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Branding
            </Text>

            <ColorInput
              label="Primary color"
              value={primaryColor}
              onChange={setPrimaryColor}
              colors={colors}
            />

            <ColorInput
              label="Secondary color"
              value={secondaryColor}
              onChange={setSecondaryColor}
              colors={colors}
            />

            {/* Color preview */}
            {primaryColorValid && secondaryColorValid && (
              <View style={styles.fieldGroup}>
                <Text
                  style={[styles.label, { color: colors.textSecondary }]}
                >
                  Preview
                </Text>
                <View style={styles.colorPreviewRow}>
                  <View
                    style={[
                      styles.colorPreviewBox,
                      { backgroundColor: primaryColor },
                    ]}
                  >
                    <Text
                      style={[styles.colorPreviewLabel, { color: secondaryColor }]}
                    >
                      Primary
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.colorPreviewBox,
                      { backgroundColor: secondaryColor },
                    ]}
                  >
                    <Text
                      style={[styles.colorPreviewLabel, { color: primaryColor }]}
                    >
                      Secondary
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Error message */}
          {error && (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: colors.error + "10",
                  borderColor: colors.error + "30",
                },
              ]}
            >
              <Ionicons
                name="alert-circle"
                size={20}
                color={colors.error}
                style={{ marginRight: 10 }}
              />
              <Text
                style={[styles.errorText, { color: colors.error, flex: 1 }]}
              >
                {error}
              </Text>
            </View>
          )}

          {/* Submit button */}
          <Pressable
            onPress={handleSubmit}
            disabled={!formValid || submitting}
            style={[
              styles.submitButton,
              {
                backgroundColor:
                  formValid && !submitting
                    ? colors.buttonPrimary
                    : colors.buttonDisabled,
              },
            ]}
          >
            {submitting && (
              <ActivityIndicator
                size="small"
                color={colors.buttonPrimaryText}
                style={{ marginRight: 8 }}
              />
            )}
            <Text
              style={[
                styles.submitButtonText,
                {
                  color:
                    formValid && !submitting
                      ? colors.buttonPrimaryText
                      : colors.buttonDisabledText,
                },
              ]}
            >
              {getPhaseLabel(submissionPhase)}
            </Text>
          </Pressable>

          {/* Stripe note */}
          {submissionPhase === "redirecting" ? (
            <Text
              style={[styles.stripeNote, { color: colors.textTertiary }]}
            >
              Payment is securely handled by Stripe.
            </Text>
          ) : (
            <Text
              style={[styles.stripeNote, { color: colors.textTertiary }]}
            >
              You will be redirected to Stripe to complete payment. Your
              community will go live after payment is confirmed.
            </Text>
          )}
        </View>
      </ScrollView>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Shared layout components
// ---------------------------------------------------------------------------

function PageContainer({
  children,
  colors,
  insets,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  return (
    <View
      style={[
        styles.page,
        {
          backgroundColor: colors.backgroundSecondary,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {children}
    </View>
  );
}

function ErrorCard({
  colors,
  title,
  message,
  onGoHome,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  title: string;
  message: string;
  onGoHome: () => void;
}) {
  return (
    <View style={styles.centeredContent}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: colors.error + "1A" },
        ]}
      >
        <Ionicons name="alert-circle" size={32} color={colors.error} />
      </View>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.cardMessage, { color: colors.textSecondary }]}>
        {message}
      </Text>
      <Pressable
        onPress={onGoHome}
        style={[
          styles.secondaryButton,
          { borderColor: colors.border },
        ]}
      >
        <Text
          style={[
            styles.secondaryButtonText,
            { color: colors.textSecondary },
          ]}
        >
          Back to home
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const MAX_WIDTH = 600;

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  formContainer: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 64,
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    width: "100%",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  cardMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  secondaryButton: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 10,
  },
  fieldHint: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  colorPickerWrapper: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: "hidden",
  },
  colorTextInput: {
    flex: 1,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  colorPreviewRow: {
    flexDirection: "row",
    gap: 12,
  },
  colorPreviewBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  colorPreviewLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  submitButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  stripeNote: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
});
