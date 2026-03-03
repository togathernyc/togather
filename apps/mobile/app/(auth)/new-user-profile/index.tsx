import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProgrammaticTextInput, ConfirmModal } from "@/components/ui";

export default function NewUserProfilePage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    phone: string;
    countryCode: string;
    otp: string;
    phoneVerificationToken?: string;
  }>();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailExistsModal, setShowEmailExistsModal] = useState(false);

  const validateEmail = (emailValue: string): boolean => {
    if (!emailValue.trim()) return false;
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return emailReg.test(emailValue);
  };

  const formatBirthday = (text: string): string => {
    // Remove non-digits
    const digits = text.replace(/\D/g, "");

    // Format as MM/DD/YYYY
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  };

  const handleBirthdayChange = (text: string) => {
    const formatted = formatBirthday(text);
    setBirthday(formatted);
    if (errors.birthday) {
      setErrors((prev) => ({ ...prev, birthday: "" }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) {
      newErrors.firstName = "First name is required";
    }

    if (!lastName.trim()) {
      newErrors.lastName = "Last name is required";
    }

    if (!email.trim()) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(email)) {
      newErrors.email = "Please enter a valid email";
    }

    if (!birthday.trim()) {
      newErrors.birthday = "Birthday is required";
    } else if (birthday.length !== 10) {
      newErrors.birthday = "Please enter a complete date (MM/DD/YYYY)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      // Check if email is already in use (primary or associated)
      const { convexVanilla, api } = await import("@/services/api/convex");
      const result = await convexVanilla.action(api.functions.auth.accountClaim.claimAccount, {
        action: "lookup",
        email: email.trim(),
        phone: params.phone,
        countryCode: params.countryCode,
      });

      if (result.user_found) {
        // Email is already associated with an account
        setIsLoading(false);
        setShowEmailExistsModal(true);
        return;
      }

      // Email is available - proceed to verification
      router.replace({
        pathname: "/(auth)/verify-email",
        params: {
          phone: params.phone,
          countryCode: params.countryCode,
          otp: params.otp,
          phoneVerificationToken: params.phoneVerificationToken || "",
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          birthday: birthday,
        },
      });
    } catch (err) {
      console.error("Error checking email:", err);
      // On error, proceed anyway - the backend will catch duplicates at registration
      router.replace({
        pathname: "/(auth)/verify-email",
        params: {
          phone: params.phone,
          countryCode: params.countryCode,
          otp: params.otp,
          phoneVerificationToken: params.phoneVerificationToken || "",
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          birthday: birthday,
        },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimAccount = () => {
    setShowEmailExistsModal(false);
    // Navigate to claim account flow with prefilled email
    router.replace({
      pathname: "/(auth)/claim-account/email",
      params: {
        phone: params.phone,
        countryCode: params.countryCode,
        otp: params.otp,
        prefillEmail: email.trim(),
      },
    });
  };

  const handleUseDifferentEmail = () => {
    setShowEmailExistsModal(false);
    // Just close modal - user can edit email
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>

          <Text style={styles.title}>Tell us about yourself</Text>
          <Text style={styles.subtitle}>
            We just need a few details to set up your account
          </Text>

          <Text style={styles.label}>First Name</Text>
          <ProgrammaticTextInput
            style={[styles.input, errors.firstName && styles.inputError]}
            placeholder="First name"
            value={firstName}
            onChangeText={(text) => {
              setFirstName(text);
              if (errors.firstName) setErrors((prev) => ({ ...prev, firstName: "" }));
            }}
            autoCapitalize="words"
            autoFocus
            programmaticCheckInterval={400}
          />
          {errors.firstName ? (
            <Text style={styles.fieldError}>{errors.firstName}</Text>
          ) : null}

          <Text style={styles.label}>Last Name</Text>
          <ProgrammaticTextInput
            style={[styles.input, errors.lastName && styles.inputError]}
            placeholder="Last name"
            value={lastName}
            onChangeText={(text) => {
              setLastName(text);
              if (errors.lastName) setErrors((prev) => ({ ...prev, lastName: "" }));
            }}
            autoCapitalize="words"
            programmaticCheckInterval={400}
          />
          {errors.lastName ? (
            <Text style={styles.fieldError}>{errors.lastName}</Text>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <ProgrammaticTextInput
            style={[styles.input, errors.email && styles.inputError]}
            placeholder="Email"
            value={email}
            onChangeText={(text) => {
              if (!/\s/.test(text)) {
                setEmail(text);
                if (errors.email) setErrors((prev) => ({ ...prev, email: "" }));
              }
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            programmaticCheckInterval={400}
          />
          {errors.email ? (
            <Text style={styles.fieldError}>{errors.email}</Text>
          ) : null}

          <Text style={styles.label}>Birthday</Text>
          <ProgrammaticTextInput
            style={[styles.input, errors.birthday && styles.inputError]}
            placeholder="MM/DD/YYYY"
            value={birthday}
            onChangeText={handleBirthdayChange}
            keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
            maxLength={10}
            programmaticCheckInterval={400}
          />
          {errors.birthday ? (
            <Text style={styles.fieldError}>{errors.birthday}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showEmailExistsModal}
        title="Email Already in Use"
        message="This email is already associated with an existing account. You can claim that account to link it with your phone number, or use a different email address."
        onConfirm={handleClaimAccount}
        onCancel={handleUseDifferentEmail}
        confirmText="Claim Account"
        cancelText="Use Different Email"
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  backButton: {
    marginBottom: 16,
    padding: 4,
    alignSelf: "flex-start",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#7f7f82",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#333",
  },
  inputError: {
    borderColor: "#FF3B30",
  },
  fieldError: {
    color: "#FF3B30",
    fontSize: 12,
    marginTop: 4,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
