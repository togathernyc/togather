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
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View style={styles.modalContent}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Add Guest</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name Section */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First Name"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Last Name"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              {/* Phone Section */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  PHONE NUMBER <Text style={styles.optionalText}>(Optional)</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number"
                  value={phone}
                  onChangeText={handlePhoneChange}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                  maxLength={10}
                />
              </View>

              {/* Email Section */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  EMAIL <Text style={styles.optionalText}>(Optional)</Text>
                </Text>
                <TextInput
                  style={[styles.input, (emailError || apiError) ? styles.inputError : null]}
                  placeholder="Email"
                  value={email}
                  onChangeText={handleEmailChange}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                {emailError ? (
                  <Text style={styles.errorText}>{emailError}</Text>
                ) : null}
                {apiError && !emailError ? (
                  <Text style={styles.errorText}>{apiError}</Text>
                ) : null}
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.submitButton, !isFormValid && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={!isFormValid}
              >
                <Text style={[styles.buttonText, styles.submitButtonText]}>
                  Add Guest to Attendance
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleClose}
              >
                <Text style={[styles.buttonText, styles.cancelButtonText]}>Cancel</Text>
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
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#fff",
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
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
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
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  optionalText: {
    fontWeight: "400",
    color: "#999",
    textTransform: "none",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fff",
    marginBottom: 12,
  },
  inputError: {
    borderColor: "#C62727",
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: "#C62727",
    marginBottom: 12,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  button: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: "#222224",
  },
  buttonDisabled: {
    backgroundColor: "#bdbdc1",
  },
  cancelButton: {
    backgroundColor: "#ecedf0",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  submitButtonText: {
    color: "#fff",
  },
  cancelButtonText: {
    color: "#4b4b4d",
  },
});

