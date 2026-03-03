import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  error?: string;
  required?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  style?: any;
  inputStyle?: any;
}

export function Input({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  error,
  required = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputContainerFocused,
          error && styles.inputContainerError,
        ]}
      >
        <TextInput
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            inputStyle,
          ]}
          placeholder={placeholder}
          placeholderTextColor="#bdbdc1"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !showPassword}
          multiline={multiline}
          numberOfLines={numberOfLines}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {secureTextEntry && (
          <TouchableOpacity
            style={styles.eyeIcon}
            onPress={() => setShowPassword(!showPassword)}
          >
            <Ionicons
              name={showPassword ? 'eye-off' : 'eye'}
              size={20}
              color="#999"
            />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  required: {
    color: '#FF3B30',
  },
  inputContainer: {
    borderWidth: 2,
    borderColor: '#ecedf0',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    ...Platform.select({
      web: {
        transition: 'all 0.2s',
      },
    }),
  },
  inputContainerFocused: {
    borderColor: '#222224',
    ...Platform.select({
      web: {
        filter: 'drop-shadow(0px 4px 4px rgba(0, 0, 0, 0.25))',
      },
    }),
  },
  inputContainerError: {
    borderColor: '#FF3B30',
  },
  input: {
    padding: 14,
    fontSize: 18,
    lineHeight: 30,
    color: '#000000',
    minHeight: 30,
    letterSpacing: 0,
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  eyeIcon: {
    position: 'absolute',
    right: 20,
    top: 14,
    padding: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 4,
  },
});

