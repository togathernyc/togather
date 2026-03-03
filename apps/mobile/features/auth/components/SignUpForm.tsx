// SignUpForm component - sign up form with all fields

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import { ProgrammaticTextInput } from "@components/ui";
import { SignUpData } from "../types";

interface SignUpFormProps {
  formData: Partial<SignUpData>;
  selectedLocation: any;
  locations: any[];
  error: string;
  isLoading: boolean;
  communityId: string | null;
  onInputChange: (field: keyof SignUpData, value: string) => void;
  onLocationChange: (location: any) => void;
  onSubmit: () => void;
  onBack: () => void;
  onSignIn: () => void;
}

export function SignUpForm({
  formData,
  selectedLocation,
  locations,
  error,
  isLoading,
  communityId,
  onInputChange,
  onLocationChange,
  onSubmit,
  onBack,
  onSignIn,
}: SignUpFormProps) {
  const router = useRouter();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [countries] = React.useState([
    { label: "United States", value: "US" },
    { label: "Canada", value: "CA" },
  ]);

  const handleTermsPress = () => {
    router.push("/(landing)/legal/terms");
  };

  const handlePrivacyPress = () => {
    router.push("/(landing)/legal/privacy");
  };

  const isSubmitDisabled = isLoading || !termsAccepted;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="arrow-back" size={24} color="#333" />
      </TouchableOpacity>

      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.subtitle}>Join your community</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Name</Text>
      <ProgrammaticTextInput
        style={styles.input}
        placeholder="First name"
        value={formData.first_name || ""}
        onChangeText={(value) => onInputChange("first_name", value)}
        autoCapitalize="words"
        editable={!isLoading}
        programmaticCheckInterval={400}
      />
      <ProgrammaticTextInput
        style={styles.input}
        placeholder="Last name"
        value={formData.last_name || ""}
        onChangeText={(value) => onInputChange("last_name", value)}
        autoCapitalize="words"
        editable={!isLoading}
        programmaticCheckInterval={400}
      />

      <Text style={styles.label}>Birthday</Text>
      <ProgrammaticTextInput
        style={styles.input}
        placeholder="MM / DD / YYYY"
        value={formData.date_of_birth || ""}
        onChangeText={(value) => onInputChange("date_of_birth", value)}
        keyboardType="numeric"
        editable={!isLoading}
        programmaticCheckInterval={400}
      />

      <Text style={styles.label}>Email</Text>
      <ProgrammaticTextInput
        style={styles.input}
        placeholder="Email"
        value={formData.email || ""}
        onChangeText={(value) => {
          if (!/\s/.test(value)) {
            onInputChange("email", value);
          }
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={!isLoading}
        programmaticCheckInterval={400}
      />

      <Text style={styles.label}>Country</Text>
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={formData.country || ""}
          onValueChange={(value) => onInputChange("country", value)}
          style={styles.picker}
          enabled={!isLoading}
        >
          <Picker.Item label="Select Country" value="" />
          {countries.map((country) => (
            <Picker.Item
              key={country.value}
              label={country.label}
              value={country.value}
            />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Location</Text>
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={selectedLocation?.id ? String(selectedLocation.id) : ""}
          onValueChange={(value) => {
            if (!value || value === "") {
              onLocationChange(null);
              return;
            }
            // Handle both string and number IDs
            const location = locations.find(
              (loc) => String(loc.id) === String(value) || loc.id === value
            );
            if (location) {
              onLocationChange(location);
            }
          }}
          style={styles.picker}
          enabled={!isLoading}
        >
          <Picker.Item label="Select Location" value="" />
          {locations.map((location) => (
            <Picker.Item
              key={location.id}
              label={location.title || location.name}
              value={String(location.id)}
            />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Password</Text>
      <ProgrammaticTextInput
        style={styles.input}
        placeholder="Password"
        value={formData.password || ""}
        onChangeText={(value) => {
          if (!/\s/.test(value)) {
            onInputChange("password", value);
          }
        }}
        secureTextEntry
        autoCapitalize="none"
        editable={!isLoading}
        onSubmitEditing={() => {
          // Prevent keyboard submit if terms not accepted
          if (termsAccepted) {
            onSubmit();
          }
        }}
        programmaticCheckInterval={400}
      />

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
        onPress={onSubmit}
        disabled={isSubmitDisabled}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Create an Account</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.linkButton} onPress={onSignIn}>
        <Text style={styles.linkText}>
          Already have an account?{" "}
          <Text style={styles.linkTextBold}>Sign In</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 500,
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
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#333",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  picker: {
    height: 50,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
    fontSize: 14,
  },
  termsContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 24,
    marginTop: 8,
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
  linkButton: {
    marginTop: 16,
    alignItems: "center",
  },
  linkText: {
    color: "#007AFF",
    fontSize: 14,
  },
  linkTextBold: {
    fontWeight: "bold",
    color: "#000",
  },
});

