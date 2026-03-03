import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onSearch?: (text: string) => void;
  onClear?: () => void;
  style?: any;
  autoFocus?: boolean;
  debounceMs?: number;
}

export function SearchBar({
  placeholder = "Search...",
  value,
  onChangeText,
  onSearch,
  onClear,
  style,
  autoFocus = false,
  debounceMs = 300,
}: SearchBarProps) {
  const [internalValue, setInternalValue] = useState(value || "");
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChangeText = (text: string) => {
    setInternalValue(text);

    if (onChangeText) {
      onChangeText(text);
    }

    // Debounce search
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (onSearch) {
      debounceTimer.current = setTimeout(() => {
        onSearch(text);
      }, debounceMs);
    }
  };

  const handleClear = () => {
    setInternalValue("");
    if (onChangeText) {
      onChangeText("");
    }
    if (onClear) {
      onClear();
    }
    if (onSearch) {
      onSearch("");
    }
  };

  React.useEffect(() => {
    if (value !== undefined) {
      setInternalValue(value);
    }
  }, [value]);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={20}
          color="#666"
          style={styles.searchIcon}
        />
        <TextInput
          style={[
            styles.input,
            Platform.OS === "web" ? { outlineStyle: "none" as any } : {},
          ]}
          placeholder={placeholder}
          placeholderTextColor="#bdbdc1"
          value={internalValue}
          onChangeText={handleChangeText}
          autoFocus={autoFocus}
          returnKeyType="search"
          onSubmitEditing={() => onSearch && onSearch(internalValue)}
        />
        {internalValue.length > 0 && (
          <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#bdbdc1" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: "#ecedf0",
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    paddingVertical: 12,
    letterSpacing: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
});
