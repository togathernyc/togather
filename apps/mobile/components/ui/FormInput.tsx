import React from 'react';
import { View, Text, StyleSheet, TextInput, TextInputProps, Platform } from 'react-native';
import { Controller, Control, FieldError } from 'react-hook-form';

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
              <Text style={styles.label}>
                {label}
                {required && <Text style={styles.required}> *</Text>}
              </Text>
            )}
            <View
              style={[
                styles.inputContainer,
                isError && styles.inputContainerError,
              ]}
            >
              <TextInput
                style={[styles.input, inputStyle]}
                value={value || ''}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholderTextColor="#bdbdc1"
                {...textInputProps}
              />
            </View>
            {displayError && (
              <Text style={styles.errorText}>{displayError}</Text>
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
    color: '#333',
    marginBottom: 8,
  },
  required: {
    color: '#FF3B30',
  },
  inputContainer: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    backgroundColor: '#fff',
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.05)',
      },
    }),
  },
  inputContainerError: {
    borderColor: '#FF3B30',
  },
  input: {
    padding: 12,
    fontSize: 16,
    color: '#333',
    letterSpacing: 0,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      },
    }),
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 4,
  },
});

