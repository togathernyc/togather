import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Keyboard,
  InputAccessoryView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ProgrammaticTextInput } from "@/components/ui";
import { formatAuthError } from "../utils/formatAuthError";
import { RegisterResult } from "../types";

const INPUT_ACCESSORY_VIEW_ID = "completeProfileKeyboard";

interface CompleteProfileScreenProps {
  phone: string;
  countryCode: string;
  otp: string;
  phoneVerificationToken?: string;
  onComplete: (result: RegisterResult) => void;
  onBack: () => void;
}

export function CompleteProfileScreen({
  phone,
  countryCode,
  otp,
  phoneVerificationToken,
  onComplete,
  onBack,
}: CompleteProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const handleTermsPress = () => {
    router.push("/(landing)/legal/terms");
  };

  const handlePrivacyPress = () => {
    router.push("/(landing)/legal/privacy");
  };

  const isSubmitDisabled = isLoading || !termsAccepted;

  const validateEmail = (emailValue: string): boolean => {
    if (!emailValue.trim()) {
      return false;
    }
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return emailReg.test(emailValue);
  };

  const handleFirstNameChange = (text: string) => {
    setFirstName(text);
    if (firstNameError) {
      setFirstNameError("");
    }
  };

  const handleLastNameChange = (text: string) => {
    setLastName(text);
    if (lastNameError) {
      setLastNameError("");
    }
  };

  const handleEmailChange = (text: string) => {
    // Prevent spaces in email
    if (!/\s/.test(text)) {
      setEmail(text);
      if (emailError) {
        setEmailError("");
      }
    }
  };

  const validateForm = (): boolean => {
    let isValid = true;

    if (!firstName.trim()) {
      setFirstNameError("First name is required");
      isValid = false;
    }

    if (!lastName.trim()) {
      setLastNameError("Last name is required");
      isValid = false;
    }

    if (!email.trim()) {
      setEmailError("Email is required");
      isValid = false;
    } else if (!validateEmail(email)) {
      setEmailError("Please enter a valid email");
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async () => {
    // Ensure terms are accepted (prevents keyboard submit bypass)
    if (!termsAccepted) {
      return;
    }

    setError("");
    setFirstNameError("");
    setLastNameError("");
    setEmailError("");

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Import Convex client dynamically to avoid circular dependencies
      const { convexVanilla, api: convexApi } = await import("@services/api/convex");

      // Call the Convex registerNewUser action
      const result = await convexVanilla.action(convexApi.functions.auth.registration.registerNewUser, {
        phone,
        countryCode,
        otp,
        phoneVerificationToken,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
      }) as RegisterResult;

      onComplete(result);
    } catch (err: any) {
      const errorMessage = formatAuthError(err);

      // Check if it's an email duplicate error
      if (
        err?.response?.status === 400 &&
        errorMessage.toLowerCase().includes("email")
      ) {
        setEmailError(errorMessage);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>

        <Text style={styles.title}>Complete Your Profile</Text>
        <Text style={styles.subtitle}>Just a few more details to get started</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.label}>First Name</Text>
        <ProgrammaticTextInput
          style={[styles.input, firstNameError && styles.inputError]}
          placeholder="First name"
          value={firstName}
          onChangeText={handleFirstNameChange}
          autoCapitalize="words"
          editable={!isLoading}
          autoFocus
          programmaticCheckInterval={400}
          inputAccessoryViewID={INPUT_ACCESSORY_VIEW_ID}
        />
        {firstNameError ? (
          <Text style={styles.fieldError}>{firstNameError}</Text>
        ) : null}

        <Text style={styles.label}>Last Name</Text>
        <ProgrammaticTextInput
          style={[styles.input, lastNameError && styles.inputError]}
          placeholder="Last name"
          value={lastName}
          onChangeText={handleLastNameChange}
          autoCapitalize="words"
          editable={!isLoading}
          programmaticCheckInterval={400}
          inputAccessoryViewID={INPUT_ACCESSORY_VIEW_ID}
        />
        {lastNameError ? (
          <Text style={styles.fieldError}>{lastNameError}</Text>
        ) : null}

        <Text style={styles.label}>Email</Text>
        <ProgrammaticTextInput
          style={[styles.input, emailError && styles.inputError]}
          placeholder="Email"
          value={email}
          onChangeText={handleEmailChange}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!isLoading}
          onSubmitEditing={handleSubmit}
          programmaticCheckInterval={400}
          inputAccessoryViewID={INPUT_ACCESSORY_VIEW_ID}
        />
        {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

        <View style={styles.termsContainer}>
          <TouchableOpacity
            onPress={() => setTermsAccepted(!termsAccepted)}
            activeOpacity={0.7}
            style={styles.checkbox}
          >
            <Ionicons
              name={termsAccepted ? "checkbox" : "square-outline"}
              size={24}
              color={termsAccepted ? "#007AFF" : "#999"}
            />
          </TouchableOpacity>
          <View style={styles.termsTextContainer}>
            <Text style={styles.termsText}>I agree to the </Text>
            <TouchableOpacity onPress={handleTermsPress}>
              <Text style={styles.termsLink}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.termsText}> and </Text>
            <TouchableOpacity onPress={handlePrivacyPress}>
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.button, isSubmitDisabled && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitDisabled}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>

      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={INPUT_ACCESSORY_VIEW_ID}>
          <View style={styles.keyboardToolbar}>
            <TouchableOpacity
              onPress={Keyboard.dismiss}
              style={styles.keyboardDoneButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.keyboardDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </ScrollView>
    </TouchableWithoutFeedback>
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
    fontSize: 32,
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
    marginBottom: 8,
  },
  errorText: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
    fontSize: 14,
  },
  termsContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 24,
    marginBottom: 8,
  },
  checkbox: {
    marginRight: 12,
    marginTop: 2,
  },
  termsTextContainer: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  termsText: {
    fontSize: 14,
    color: "#7f7f82",
    lineHeight: 22,
  },
  termsLink: {
    color: "#007AFF",
    textDecorationLine: "underline",
    fontSize: 14,
    lineHeight: 22,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  keyboardToolbar: {
    backgroundColor: "#f8f8f8",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ccc",
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  keyboardDoneButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  keyboardDoneText: {
    color: "#007AFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
