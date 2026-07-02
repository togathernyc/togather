/**
 * DatePicker (Web / Desktop)
 *
 * The native HTML `<input type="datetime-local">` we used previously was
 * unreliable on desktop: it bound a UTC ISO string into a control that reads
 * and writes *local* time, so typing or picking a value could jump to a
 * seemingly random date. This variant replaces it with the MUI Desktop Date
 * Picker, which parses and formats consistently in local time.
 *
 * This file is web-only (Metro resolves `.web.tsx` for the web bundle), so the
 * MUI/emotion dependency never reaches the native bundles. The native
 * implementation lives in `DatePicker.tsx`.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DesktopDatePicker } from '@mui/x-date-pickers/DesktopDatePicker';
import { DesktopTimePicker } from '@mui/x-date-pickers/DesktopTimePicker';
import { DesktopDateTimePicker } from '@mui/x-date-pickers/DesktopDateTimePicker';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';

interface DatePickerProps {
  label?: string;
  value?: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  style?: any;
  disabled?: boolean;
  mode?: 'date' | 'time' | 'datetime';
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder,
  error,
  required = false,
  minimumDate,
  maximumDate,
  style,
  disabled = false,
  mode = 'date',
}: DatePickerProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  // Match the picker's palette to the community theme so the calendar/clock
  // and selected-day highlight stay on-brand and legible in light/dark mode.
  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDark ? 'dark' : 'light',
          primary: { main: primaryColor },
          background: { paper: colors.surface },
          text: { primary: colors.text, secondary: colors.textSecondary },
        },
      }),
    [primaryColor, isDark, colors.surface, colors.text, colors.textSecondary]
  );

  // MUI fires onChange with an Invalid Date object while the user is mid-typing.
  // Only propagate a cleared value (null) or a fully valid date so we never
  // clobber the parent's state with garbage.
  const handleChange = (next: Date | null) => {
    if (next === null) {
      onChange(null);
      return;
    }
    if (next instanceof Date && !isNaN(next.getTime())) {
      onChange(next);
    }
  };

  const textFieldSx = {
    width: '100%',
    '& .MuiOutlinedInput-root': {
      borderRadius: '8px',
      backgroundColor: disabled ? colors.surfaceSecondary : colors.inputBackground,
      color: colors.text,
      fontSize: '16px',
      '& fieldset': {
        borderWidth: 2,
        borderColor: error ? colors.error : colors.border,
      },
      '&:hover fieldset': {
        borderColor: error ? colors.error : colors.border,
      },
      '&.Mui-focused fieldset': {
        borderColor: error ? colors.error : primaryColor,
      },
    },
    '& .MuiInputBase-input': {
      padding: '12px 16px',
      color: colors.text,
    },
    '& .MuiInputBase-input::placeholder': {
      color: colors.inputPlaceholder,
      opacity: 1,
    },
  };

  const slotProps = {
    textField: {
      fullWidth: true,
      error: !!error,
      placeholder,
      disabled,
      sx: textFieldSx,
    },
  } as const;

  const commonProps = {
    value: value ?? null,
    onChange: handleChange,
    disabled,
    slotProps,
  };

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
        </Text>
      )}
      <ThemeProvider theme={muiTheme}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          {mode === 'time' ? (
            <DesktopTimePicker {...commonProps} />
          ) : mode === 'datetime' ? (
            <DesktopDateTimePicker
              {...commonProps}
              minDate={minimumDate}
              maxDate={maximumDate}
            />
          ) : (
            <DesktopDatePicker
              {...commonProps}
              minDate={minimumDate}
              maxDate={maximumDate}
            />
          )}
        </LocalizationProvider>
      </ThemeProvider>
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
    </View>
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
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
});
