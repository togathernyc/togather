/**
 * FinanceOnboardingFormScreen — data wrapper for the community finance
 * intake form (ADR-032 §2 step 1). Submits `startOnboarding` and returns to
 * the status checklist on success.
 */
import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { ToastManager } from "@components/ui";
import { formatError } from "@/utils/error-handling";
import { FinanceOnboardingFormView, type FinanceOnboardingFormValues } from "./FinanceOnboardingFormView";

export function FinanceOnboardingFormScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community } = useAuth();

  const startOnboarding = useAuthenticatedMutation(api.functions.finance.onboarding.startOnboarding);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (values: FinanceOnboardingFormValues) => {
    if (!community?.id || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await startOnboarding({
        communityId: community.id as Id<"communities">,
        legalName: values.legalName.trim(),
        ein: values.ein.trim(),
        website: values.website.trim() || undefined,
        statementDescriptor: values.statementDescriptor.trim() || undefined,
        address: {
          addressLine1: values.addressLine1.trim(),
          addressLine2: values.addressLine2.trim() || undefined,
          city: values.city.trim(),
          state: values.state.trim(),
          zipCode: values.zipCode.trim(),
        },
      });
      ToastManager.success("Details submitted");
      router.replace("/(user)/leader-tools/finance-setup");
    } catch (error) {
      setSubmitError(formatError(error, "Failed to submit details"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Set up giving</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Church details</Text>
        </View>
      </View>

      <FinanceOnboardingFormView
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
});
