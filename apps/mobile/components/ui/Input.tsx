import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

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
  const { colors } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={{ color: colors.error }}> *</Text>}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          { borderColor: colors.border, backgroundColor: colors.inputBackground },
          isFocused && [styles.inputContainerFocused, { borderColor: colors.text }],
          error && { borderColor: colors.error },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { color: colors.text },
            multiline && styles.inputMultiline,
            inputStyle,
          ]}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
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
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
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
    marginBottom: 8,
  },
  inputContainer: {
    borderWidth: 2,
    borderRadius: 14,
    ...Platform.select({
      web: {
        transition: 'all 0.2s',
      },
    }),
  },
  inputContainerFocused: {
    ...Platform.select({
      web: {
        filter: 'drop-shadow(0px 4px 4px rgba(0, 0, 0, 0.25))',
      },
    }),
  },
  input: {
    padding: 14,
    fontSize: 18,
    lineHeight: 30,
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
    marginTop: 4,
  },
});
