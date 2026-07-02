import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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
  placeholder = 'Select a date',
  error,
  required = false,
  minimumDate,
  maximumDate,
  style,
  disabled = false,
  mode = 'date',
}: DatePickerProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  // Track whether we're picking date or time (for datetime mode on iOS)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);
  // iOS spinner mode: store temp value until Done is pressed
  const [tempIOSDate, setTempIOSDate] = useState<Date | null>(null);

  const formatDate = (date: Date | null) => {
    if (!date) return '';
    
    if (mode === 'time') {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    
    if (mode === 'datetime') {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // The web/desktop implementation lives in DatePicker.web.tsx (MUI Desktop
  // Date Picker); Metro resolves it for the web bundle. This file handles the
  // native iOS/Android pickers only.

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      setShowTimePicker(false);
    }

    if (event.type === 'dismissed') {
      setShowDatePicker(false);
      setShowTimePicker(false);
      setTempDate(null);
      return;
    }

    if (selectedDate) {
      if (Platform.OS === 'ios') {
        // iOS spinner mode: store temp value until Done is pressed
        setTempIOSDate(selectedDate);
      } else if (mode === 'datetime' && Platform.OS === 'android') {
        if (showDatePicker) {
          // Date was selected, now show time picker
          setTempDate(selectedDate);
          setShowDatePicker(false);
          setShowTimePicker(true);
        } else if (showTimePicker && tempDate) {
          // Time was selected, combine with date
          const finalDate = new Date(tempDate);
          finalDate.setHours(selectedDate.getHours());
          finalDate.setMinutes(selectedDate.getMinutes());
          onChange(finalDate);
          setTempDate(null);
        }
      } else {
        onChange(selectedDate);
      }
    }
  };

  const handlePress = () => {
    if (disabled) return;

    if (Platform.OS === 'ios') {
      // Initialize temp value with current value or now
      setTempIOSDate(value || new Date());
      setModalVisible(true);
    } else {
      // Android: show date picker first for datetime mode
      if (mode === 'datetime' || mode === 'date') {
        setShowDatePicker(true);
      } else {
        setShowTimePicker(true);
      }
    }
  };

  const handleIOSConfirm = () => {
    // Commit the temp value when Done is pressed
    if (tempIOSDate) {
      onChange(tempIOSDate);
    }
    setModalVisible(false);
  };

  const handleIOSCancel = () => {
    setTempIOSDate(null);
    setModalVisible(false);
  };

  // For native platforms
  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={[styles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
        </Text>
      )}
      <TouchableOpacity
        style={[
          styles.select,
          { borderColor: colors.border, backgroundColor: colors.inputBackground },
          error && { borderColor: colors.error },
          disabled && { backgroundColor: colors.surfaceSecondary, opacity: 0.6 },
        ]}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.selectText,
            { color: colors.text },
            !value && { color: colors.inputPlaceholder },
            disabled && { color: colors.inputPlaceholder },
          ]}
        >
          {value ? formatDate(value) : placeholder}
        </Text>
        <Ionicons
          name={mode === "time" ? "time-outline" : "calendar-outline"}
          size={20}
          color={disabled ? colors.inputPlaceholder : colors.icon}
        />
      </TouchableOpacity>
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

      {/* iOS Modal with inline picker */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={modalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.iosPickerContainer, { backgroundColor: colors.surface }]}>
              <View style={[styles.iosPickerHeader, { borderBottomColor: colors.borderLight }]}>
                <TouchableOpacity onPress={handleIOSCancel}>
                  <Text style={[styles.iosPickerCancel, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.iosPickerTitle, { color: colors.text }]}>
                  Select {mode === 'time' ? 'Time' : mode === 'datetime' ? 'Date & Time' : 'Date'}
                </Text>
                <TouchableOpacity onPress={handleIOSConfirm}>
                  <Text style={[styles.iosPickerDone, { color: primaryColor }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempIOSDate || value || new Date()}
                mode={mode}
                display="spinner"
                onChange={handleDateChange}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                style={styles.iosPicker}
                textColor={colors.text}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Android date picker */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={value || new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}

      {/* Android time picker */}
      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker
          value={tempDate || value || new Date()}
          mode="time"
          display="default"
          onChange={handleDateChange}
        />
      )}
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
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  selectText: {
    flex: 1,
    fontSize: 16,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  iosPickerContainer: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  iosPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  iosPickerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  iosPickerCancel: {
    fontSize: 17,
  },
  iosPickerDone: {
    fontSize: 17,
    fontWeight: '600',
  },
  iosPicker: {
    height: 200,
  },
});

