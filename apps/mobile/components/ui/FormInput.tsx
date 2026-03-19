import React from 'react';
import { View, Text, StyleSheet, TextInput, TextInputProps, Platform } from 'react-native';
import { Controller, Control, FieldError } from 'react-hook-form';
import { useTheme } from '@hooks/useTheme';

interface FormInputProps extends Omit<TextInputProps, 'style'> {
  name: string;
  control: Control<any>;
  label?: string;
  error?: FieldError | string;
  required?: boolean;
  containerStyle?: any;
  inputStyle?: any;
}

export function FormInput({
  name,
  control,
  label,
  error,
  required = false,
  containerStyle,
  inputStyle,
  ...textInputProps
}: FormInputProps) {
  const { colors } = useTheme();
  const errorMessage = typeof error === 'string' ? error : error?.message;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error: fieldError } }) => {
        const displayError = errorMessage || fieldError?.message;
        const isError = !!displayError;

        return (
          <View style={[styles.container, containerStyle]}>
            {label && (
              <Text style={[styles.label, { color: colors.text }]}>
                {label}
                {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
              </Text>
            )}
            <View
              style={[
                styles.inputContainer,
                { borderColor: colors.border, backgroundColor: colors.inputBackground },
                isError && { borderColor: colors.error },
              ]}
            >
              <TextInput
                style={[styles.input, { color: colors.text }, inputStyle]}
                value={value || ''}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholderTextColor={colors.inputPlaceholder}
                {...textInputProps}
              />
            </View>
            {displayError && (
              <Text style={[styles.errorText, { color: colors.error }]}>{displayError}</Text>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  required: {},
  inputContainer: {
    borderWidth: 1,
    borderRadius: 8,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.05)',
      },
    }),
  },
  input: {
    padding: 12,
    fontSize: 16,
    letterSpacing: 0,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      },
    }),
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
});

