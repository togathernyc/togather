import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";

export function ProposalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { isAuthenticated, token, isLoading, user } = useAuth();
  const submitProposal = useMutation(api.functions.ee.proposals.submit);

  const userHasEmail = !!user?.email;

  const [communityName, setCommunityName] = useState("");
  const [estimatedSize, setEstimatedSize] = useState("");
  const [proposedMonthlyPrice, setProposedMonthlyPrice] = useState("200");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [notes, setNotes] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Redirect to sign-in if not authenticated (wait for auth to initialize first)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/(auth)/signin?redirect=/onboarding/proposal");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!communityName.trim()) {
      setError("Community name is required.");
      return;
    }

    const size = Number(estimatedSize);
    if (!estimatedSize || isNaN(size) || size < 1) {
      setError("Please enter a valid estimated number of people.");
      return;
    }

    const price = Number(proposedMonthlyPrice);
    if (!proposedMonthlyPrice || isNaN(price) || price < 0) {
      setError("Please enter a valid proposed monthly price.");
      return;
    }

    if (!token) {
      setError("You must be signed in to submit a proposal.");
      return;
    }

    // Validate email — either from profile or entered on form
    const email = userHasEmail ? user.email : contactEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("A valid email address is required so we can contact you about your proposal.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitProposal({
        token,
        communityName: communityName.trim(),
        estimatedSize: size,
        needsMigration,
        proposedMonthlyPrice: price,
        notes: notes.trim() || undefined,
        contactEmail: !userHasEmail ? contactEmail.trim() : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    communityName,
    estimatedSize,
    proposedMonthlyPrice,
    needsMigration,
    notes,
    token,
    submitProposal,
  ]);

  if (isLoading || !isAuthenticated) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.backgroundSecondary }}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (submitted) {
    return (
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.backgroundSecondary }]}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View
            style={[styles.successIconContainer, { backgroundColor: colors.success }]}
          >
            <Ionicons name="checkmark" size={28} color="#ffffff" />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>
            Proposal Submitted
          </Text>
          <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
            We've received your proposal. We'll review it and get back to you
            via email.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={[styles.brandText, { color: colors.text }]}>togather</Text>
      <Text style={[styles.heading, { color: colors.text }]}>
        Propose a Community
      </Text>
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        Tell us about your community and we'll get you set up on Togather.
      </Text>

      {/* Form card */}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {/* Contact Email (only if user doesn't have one on file) */}
        {!userHasEmail && (
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              Contact Email <Text style={{ color: colors.error }}>*</Text>
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
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.inputPlaceholder}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>
              We'll use this email to send you updates about your proposal.
            </Text>
          </View>
        )}

        {/* Community Name */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            Community Name <Text style={{ color: colors.error }}>*</Text>
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
            value={communityName}
            onChangeText={setCommunityName}
            placeholder="e.g. Grace Church NYC"
            placeholderTextColor={colors.inputPlaceholder}
            autoCapitalize="words"
          />
        </View>

        {/* Estimated Size */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            Estimated Number of People{" "}
            <Text style={{ color: colors.error }}>*</Text>
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
            value={estimatedSize}
            onChangeText={setEstimatedSize}
            placeholder="e.g. 150"
            placeholderTextColor={colors.inputPlaceholder}
            keyboardType="number-pad"
            inputMode="numeric"
          />
        </View>

        {/* Proposed Monthly Price */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            Proposed Monthly Price{" "}
            <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <View
            style={[
              styles.priceInputContainer,
              {
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
              },
            ]}
          >
            <Text style={[styles.pricePrefix, { color: colors.textSecondary }]}>
              $
            </Text>
            <TextInput
              style={[styles.priceInput, { color: colors.text }]}
              value={proposedMonthlyPrice}
              onChangeText={setProposedMonthlyPrice}
              placeholder="200"
              placeholderTextColor={colors.inputPlaceholder}
              keyboardType="number-pad"
              inputMode="numeric"
            />
          </View>
        </View>

        {/* Migration Switch */}
        <View style={styles.fieldGroup}>
          <View style={styles.switchRow}>
            <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
              Need Help Migrating?
            </Text>
            <Switch
              value={needsMigration}
              onValueChange={setNeedsMigration}
              trackColor={{
                false: colors.border,
                true: colors.buttonPrimary,
              }}
            />
          </View>
          {needsMigration && (
            <View
              style={[
                styles.migrationInfo,
                {
                  backgroundColor: isDark
                    ? "rgba(255, 149, 0, 0.15)"
                    : "#FFF8E1",
                  borderColor: isDark
                    ? "rgba(255, 149, 0, 0.3)"
                    : "#FFE082",
                },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.warning}
                style={styles.migrationInfoIcon}
              />
              <Text
                style={[
                  styles.migrationInfoText,
                  { color: isDark ? colors.warning : "#795600" },
                ]}
              >
                Migration assistance is a one-time $500 flat fee.
              </Text>
            </View>
          )}
        </View>

        {/* Additional Notes */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            Additional Notes{" "}
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
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else you'd like us to know about your community..."
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Error */}
        {error && (
          <View
            style={[
              styles.errorContainer,
              {
                backgroundColor: isDark
                  ? "rgba(255, 59, 48, 0.15)"
                  : "#FFF0F0",
                borderColor: isDark
                  ? "rgba(255, 59, 48, 0.3)"
                  : "#FFCCCC",
              },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.error }]}>
              {error}
            </Text>
          </View>
        )}

        {/* Submit */}
        <Pressable
          style={[
            styles.submitButton,
            {
              backgroundColor: isSubmitting
                ? colors.buttonDisabled
                : colors.buttonPrimary,
            },
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.buttonPrimaryText} size="small" />
          ) : (
            <Text
              style={[styles.submitButtonText, { color: colors.buttonPrimaryText }]}
            >
              Submit Proposal
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    alignItems: "center",
  },
  brandText: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 24,
    alignSelf: "flex-start",
    maxWidth: 600,
    width: "100%",
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    alignSelf: "flex-start",
    maxWidth: 600,
    width: "100%",
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 24,
    alignSelf: "flex-start",
    maxWidth: 600,
    width: "100%",
  },
  card: {
    width: "100%",
    maxWidth: 600,
    borderRadius: 16,
    padding: 24,
    ...Platform.select({
      web: {
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  priceInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  pricePrefix: {
    fontSize: 16,
    fontWeight: "500",
    marginRight: 4,
  },
  priceInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  migrationInfo: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  migrationInfoIcon: {
    marginRight: 8,
  },
  migrationInfoText: {
    fontSize: 13,
    flex: 1,
  },
  errorContainer: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 14,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  successIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  successMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
