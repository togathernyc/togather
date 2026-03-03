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

  const handleDateSelect = (selectedDate: Date) => {
    onChange(selectedDate);
    setModalVisible(false);
  };

  // For web, use native HTML date input
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, style]}>
        {label && (
          <Text style={styles.label}>
            {label}
            {required && <Text style={styles.required}> *</Text>}
          </Text>
        )}
        <input
          type={mode === 'time' ? 'time' : mode === 'datetime' ? 'datetime-local' : 'date'}
          value={value ? (mode === 'time' ? value.toTimeString().slice(0, 5) : value.toISOString().slice(0, mode === 'datetime' ? 16 : 10)) : ''}
          onChange={(e) => {
            if (e.target.value) {
              const date = new Date(e.target.value);
              // Validate the date before calling onChange
              if (!isNaN(date.getTime())) {
                onChange(date);
              } else {
                console.warn('Invalid date value from input:', e.target.value);
                onChange(null);
              }
            } else {
              onChange(null);
            }
          }}
          min={minimumDate ? minimumDate.toISOString().slice(0, 10) : undefined}
          max={maximumDate ? maximumDate.toISOString().slice(0, 10) : undefined}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: '16px',
            border: error ? '2px solid #FF3B30' : '2px solid #ecedf0',
            borderRadius: '8px',
            backgroundColor: disabled ? '#f5f5f5' : '#fff',
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

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
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <TouchableOpacity
        style={[
          styles.select,
          error && styles.selectError,
          disabled && styles.selectDisabled,
        ]}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.selectText,
            !value && styles.selectPlaceholder,
            disabled && styles.selectTextDisabled,
          ]}
        >
          {value ? formatDate(value) : placeholder}
        </Text>
        <Ionicons
          name="calendar-outline"
          size={20}
          color={disabled ? '#bdbdc1' : '#666'}
        />
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* iOS Modal with inline picker */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={modalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.iosPickerContainer}>
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity onPress={handleIOSCancel}>
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.iosPickerTitle}>
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
                textColor="#000000"
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
    color: '#333',
    marginBottom: 8,
  },
  required: {
    color: '#FF3B30',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#ecedf0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    minHeight: 48,
  },
  selectError: {
    borderColor: '#FF3B30',
  },
  selectDisabled: {
    backgroundColor: '#f5f5f5',
    opacity: 0.6,
  },
  selectText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  selectPlaceholder: {
    color: '#bdbdc1',
  },
  selectTextDisabled: {
    color: '#bdbdc1',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  iosPickerContainer: {
    backgroundColor: '#fff',
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
    borderBottomColor: '#eee',
  },
  iosPickerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  iosPickerCancel: {
    fontSize: 17,
    color: '#666',
  },
  iosPickerDone: {
    fontSize: 17,
    fontWeight: '600',
  },
  iosPicker: {
    height: 200,
  },
});

