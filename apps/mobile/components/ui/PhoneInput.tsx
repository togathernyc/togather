import React, { useState, useCallback } from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Modal,
  FlatList,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

// Common country codes
const COUNTRIES = [
  { code: "US", name: "United States", dialCode: "+1", flag: "🇺🇸" },
  { code: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦" },
  { code: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { code: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺" },
  { code: "DE", name: "Germany", dialCode: "+49", flag: "🇩🇪" },
  { code: "FR", name: "France", dialCode: "+33", flag: "🇫🇷" },
  { code: "IT", name: "Italy", dialCode: "+39", flag: "🇮🇹" },
  { code: "ES", name: "Spain", dialCode: "+34", flag: "🇪🇸" },
  { code: "BR", name: "Brazil", dialCode: "+55", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", dialCode: "+52", flag: "🇲🇽" },
  { code: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" },
  { code: "CN", name: "China", dialCode: "+86", flag: "🇨🇳" },
  { code: "JP", name: "Japan", dialCode: "+81", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", dialCode: "+82", flag: "🇰🇷" },
  { code: "NG", name: "Nigeria", dialCode: "+234", flag: "🇳🇬" },
  { code: "GH", name: "Ghana", dialCode: "+233", flag: "🇬🇭" },
  { code: "KE", name: "Kenya", dialCode: "+254", flag: "🇰🇪" },
  { code: "ZA", name: "South Africa", dialCode: "+27", flag: "🇿🇦" },
];

interface PhoneInputProps {
  value: string;
  onChangeText: (text: string) => void;
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  error?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function PhoneInput({
  value,
  onChangeText,
  countryCode,
  onCountryCodeChange,
  error,
  placeholder = "Phone number",
  autoFocus = false,
}: PhoneInputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const selectedCountry =
    COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

  const handlePhoneChange = useCallback(
    (text: string) => {
      // Only allow digits and common phone formatting characters
      const cleaned = text.replace(/[^\d\s\-()]/g, "");
      onChangeText(cleaned);
    },
    [onChangeText]
  );

  const renderCountryItem = ({ item }: { item: (typeof COUNTRIES)[0] }) => (
    <TouchableOpacity
      style={[styles.countryItem, { borderBottomColor: colors.surfaceSecondary }]}
      onPress={() => {
        onCountryCodeChange(item.code);
        setShowCountryPicker(false);
      }}
    >
      <Text style={styles.countryFlag}>{item.flag}</Text>
      <Text style={[styles.countryName, { color: colors.text }]}>{item.name}</Text>
      <Text style={[styles.countryDialCode, { color: colors.text }]}>{item.dialCode}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.inputContainer,
          { borderColor: colors.border, backgroundColor: colors.inputBackground },
          isFocused && { borderColor: colors.buttonPrimary },
          error && { borderColor: colors.error },
        ]}
      >
        <TouchableOpacity
          style={styles.countrySelector}
          onPress={() => setShowCountryPicker(true)}
        >
          <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
          <Text style={[styles.countryDialCode, { color: colors.text }]}>{selectedCountry.dialCode}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.icon} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          value={value}
          onChangeText={handlePhoneChange}
          keyboardType="phone-pad"
          autoFocus={autoFocus}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          testID="phone-input"
        />
      </View>
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

      <Modal
        visible={showCountryPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setShowCountryPicker(false)}
        >
          <Pressable style={[styles.modalContent, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRIES}
              renderItem={renderCountryItem}
              keyExtractor={(item) => item.code}
              showsVerticalScrollIndicator={false}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    width: "100%",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderRadius: 14,
    ...Platform.select({
      web: {
        transition: "all 0.2s",
      },
    }),
  },
  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 6,
  },
  countryFlag: {
    fontSize: 20,
  },
  countryDialCode: {
    fontSize: 16,
    fontWeight: "500",
  },
  divider: {
    width: 1,
    height: 24,
  },
  input: {
    flex: 1,
    padding: 14,
    fontSize: 18,
    letterSpacing: 0,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  countryName: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
  },
});
