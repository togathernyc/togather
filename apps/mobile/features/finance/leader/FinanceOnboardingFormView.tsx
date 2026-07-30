/**
 * FinanceOnboardingFormView — the community admin's "one form" intake
 * (ADR-032 §2 step 1: legal name, EIN, address, website). Plain props only,
 * no Convex — see FinanceOnboardingFormScreen.tsx for the data wrapper.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTheme } from "@hooks/useTheme";
import { FormInput, Button } from "@components/ui";
import { formatEinInput } from "./utils";

export interface FinanceOnboardingFormValues {
  legalName: string;
  ein: string;
  website: string;
  statementDescriptor: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
}

const EIN_MESSAGE = "EIN must be in NN-NNNNNNN format";

const schema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required"),
  ein: z.string().regex(/^\d{2}-\d{7}$/, EIN_MESSAGE),
  website: z.string().trim().optional().or(z.literal("")),
  statementDescriptor: z.string().trim().max(22, "Keep it to 22 characters").optional().or(z.literal("")),
  addressLine1: z.string().trim().min(1, "Address is required"),
  addressLine2: z.string().trim().optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  zipCode: z.string().trim().min(1, "ZIP code is required"),
});

const EMPTY_DEFAULTS: FinanceOnboardingFormValues = {
  legalName: "",
  ein: "",
  website: "",
  statementDescriptor: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zipCode: "",
};

export interface FinanceOnboardingFormViewProps {
  defaultValues?: Partial<FinanceOnboardingFormValues>;
  isSubmitting: boolean;
  submitError?: string | null;
  onSubmit: (values: FinanceOnboardingFormValues) => void;
}

export function FinanceOnboardingFormView({
  defaultValues,
  isSubmitting,
  submitError,
  onSubmit,
}: FinanceOnboardingFormViewProps) {
  const { colors } = useTheme();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FinanceOnboardingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...EMPTY_DEFAULTS, ...defaultValues },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Church details</Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          One form, collected once — we submit this to both our payments and banking
          partners on your behalf.
        </Text>

        <FormInput
          name="legalName"
          control={control}
          label="Legal name"
          required
          error={errors.legalName}
          placeholder="First Community Church"
          testID="onboarding-legal-name"
        />

        <FormInput
          name="ein"
          control={control}
          label="EIN"
          required
          error={errors.ein}
          placeholder="12-3456789"
          keyboardType="number-pad"
          formatValue={formatEinInput}
          maxLength={10}
          testID="onboarding-ein"
        />

        <FormInput
          name="website"
          control={control}
          label="Website (optional)"
          error={errors.website}
          placeholder="https://example.org"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FormInput
          name="statementDescriptor"
          control={control}
          label="Statement descriptor (optional)"
          error={errors.statementDescriptor}
          placeholder="How donations appear on statements"
          maxLength={22}
        />
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Address</Text>

        <FormInput
          name="addressLine1"
          control={control}
          label="Address line 1"
          required
          error={errors.addressLine1}
          placeholder="Street address"
          testID="onboarding-address-line1"
        />

        <FormInput
          name="addressLine2"
          control={control}
          label="Address line 2 (optional)"
          error={errors.addressLine2}
          placeholder="Suite, unit, etc."
        />

        <FormInput
          name="city"
          control={control}
          label="City"
          required
          error={errors.city}
          placeholder="City"
          testID="onboarding-city"
        />

        <FormInput
          name="state"
          control={control}
          label="State"
          required
          error={errors.state}
          placeholder="State"
          testID="onboarding-state"
        />

        <FormInput
          name="zipCode"
          control={control}
          label="ZIP code"
          required
          error={errors.zipCode}
          placeholder="ZIP"
          keyboardType="number-pad"
          testID="onboarding-zip"
        />
      </View>

      {submitError ? (
        <Text style={[styles.submitError, { color: colors.error }]}>{submitError}</Text>
      ) : null}

      <Button
        variant="primary"
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
        style={styles.submitButton}
      >
        Submit
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  submitError: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
  },
  submitButton: {
    marginBottom: 24,
  },
});
