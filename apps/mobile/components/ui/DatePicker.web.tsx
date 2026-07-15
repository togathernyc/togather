import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ReactDatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useTheme } from '@hooks/useTheme';

// react-datepicker's wrapper defaults to `display: inline-block`, which would
// collapse our full-width input to its content width. Inject a one-time rule so
// the wrapper (and thus the input) fills the field like the native path does.
if (typeof document !== 'undefined' && !document.getElementById('togather-datepicker-style')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'togather-datepicker-style';
  styleEl.textContent =
    '.togather-datepicker-wrapper{display:block;width:100%}' +
    '.togather-datepicker-wrapper .react-datepicker__input-container{display:block;width:100%}';
  document.head.appendChild(styleEl);
}

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

/**
 * Web implementation of DatePicker backed by `react-datepicker`.
 *
 * Metro resolves this file for web (`.web.tsx`) and `DatePicker.tsx` for native.
 * react-datepicker works with local-time `Date` objects natively, so there is
 * NO UTC round-trip here — a selected 9am stays 9am local.
 */
export function DatePicker({
  label,
  value,
  onChange,
  placeholder = 'Select a date',
  error,
  required = false,
  minimumDate,
  maximumDate,
  style,
  disabled = false,
  mode = 'date',
}: DatePickerProps) {
  const { colors } = useTheme();

  // Map `mode` to react-datepicker display + time options.
  const isTime = mode === 'time';
  const isDateTime = mode === 'datetime';
  const dateFormat = isTime
    ? 'h:mm aa'
    : isDateTime
      ? 'MMM d, yyyy h:mm aa'
      : 'MMM d, yyyy';

  // Custom input keeps the field visually identical to the native path
  // (bordered, rounded, themed) while react-datepicker drives the calendar.
  const CustomInput = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement>
  >(({ value: inputValue, onClick, onChange: onInputChange }, ref) => (
    <input
      ref={ref}
      value={(inputValue as string) ?? ''}
      onClick={onClick}
      onChange={onInputChange}
      placeholder={placeholder}
      disabled={disabled}
      readOnly
      style={{
        width: '100%',
        padding: '12px 16px',
        fontSize: '16px',
        border: error ? `2px solid ${colors.error}` : `2px solid ${colors.border}`,
        borderRadius: '8px',
        backgroundColor: disabled ? colors.surfaceSecondary : colors.inputBackground,
        outline: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: value ? colors.text : colors.inputPlaceholder,
        boxSizing: 'border-box',
      }}
    />
  ));
  CustomInput.displayName = 'DatePickerCustomInput';

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
        </Text>
      )}
      <ReactDatePicker
        selected={value ?? null}
        onChange={(date: Date | null) => onChange(date)}
        disabled={disabled}
        minDate={minimumDate}
        maxDate={maximumDate}
        placeholderText={placeholder}
        dateFormat={dateFormat}
        showTimeSelect={isTime || isDateTime}
        showTimeSelectOnly={isTime}
        timeIntervals={15}
        customInput={<CustomInput />}
        wrapperClassName="togather-datepicker-wrapper"
      />
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
