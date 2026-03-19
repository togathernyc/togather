import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface AddGuestProps {
  visible: boolean;
  onClose: () => void;
  onAddGuest: (guest: {
    email?: string;
    first_name: string;
    last_name: string;
    phone?: string;
  }) => Promise<void>;
  error?: string | null;
}

export function AddGuest({ visible, onClose, onAddGuest, error: externalError }: AddGuestProps) {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailError, setEmailError] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateEmail = (emailValue: string) => {
    const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (emailValue && !emailReg.test(emailValue)) {
      setEmailError("Please enter a valid email.");
      return false;
    } else {
      setEmailError("");
      return true;
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (text) {
      validateEmail(text);
    } else {
      setEmailError("");
    }
  };

  const handlePhoneChange = (text: string) => {
    // Limit phone to 10 digits (US format)
    const cleaned = text.replace(/[^\d]/g, "");
    if (cleaned.length <= 10) {
      setPhone(cleaned);
    }
  };

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      return;
    }

    // Only validate email if provided
    if (email.trim() && !validateEmail(email)) {
      return;
    }

    setApiError(null);
    setIsSubmitting(true);

    try {
      await onAddGuest({
        email: email.trim() || undefined,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || undefined,
    });

      // Reset form on success
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setEmailError("");
      setApiError(null);
    } catch (error: any) {
      // Extract error message from the error
      const errorMessage = error?.message || "Failed to add guest. Please try again.";
      setApiError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    // Reset form on close
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setEmailError("");
    setApiError(null);
    onClose();
  };

  // Update API error when external error changes
  React.useEffect(() => {
    if (externalError) {
      setApiError(externalError);
    }
  }, [externalError]);

  const isFormValid = firstName.trim() && lastName.trim() && !emailError && !isSubmitting;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Add Guest</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>NAME</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  placeholder="First Name"
                  placeholderTextColor={colors.textTertiary}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
                <TextInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  placeholder="Last Name"
                  placeholderTextColor={colors.textTertiary}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              {/* Phone Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  PHONE NUMBER <Text style={[styles.optionalText, { color: colors.textTertiary }]}>(Optional)</Text>
                </Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
                  placeholder="Phone Number"
                  placeholderTextColor={colors.textTertiary}
                  value={phone}
                  onChangeText={handlePhoneChange}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                  maxLength={10}
                />
              </View>

              {/* Email Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  EMAIL <Text style={[styles.optionalText, { color: colors.textTertiary }]}>(Optional)</Text>
                </Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }, (emailError || apiError) ? { borderColor: colors.destructive } : null]}
                  placeholder="Email"
                  placeholderTextColor={colors.textTertiary}
                  value={email}
                  onChangeText={handleEmailChange}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                {emailError ? (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{emailError}</Text>
                ) : null}
                {apiError && !emailError ? (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{apiError}</Text>
                ) : null}
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={[styles.buttonContainer, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.buttonPrimary }, !isFormValid && { backgroundColor: colors.buttonDisabled }]}
                onPress={handleSubmit}
                disabled={!isFormValid}
              >
                <Text style={[styles.buttonText, { color: colors.textInverse }]}>
                  Add Guest to Attendance
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.surfaceSecondary }]}
                onPress={handleClose}
              >
                <Text style={[styles.buttonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    minHeight: 400,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  optionalText: {
    fontWeight: "400",
    textTransform: "none",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 12,
    marginBottom: 12,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
  },
  button: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
});

