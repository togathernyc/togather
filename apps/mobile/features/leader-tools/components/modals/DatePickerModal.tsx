import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { DatePicker } from "@components/ui/DatePicker";

interface DatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: Date) => void;
  currentDate: Date;
  minimumDate?: Date;
  maximumDate?: Date;
}

export function DatePickerModal({
  visible,
  onClose,
  onSelectDate,
  currentDate,
  minimumDate,
  maximumDate,
}: DatePickerModalProps) {
  const [selectedDate, setSelectedDate] = useState(currentDate);

  const handleSelect = () => {
    // Ensure selectedDate is a Date object before passing it
    let dateObj: Date;
    if (selectedDate instanceof Date) {
      dateObj = selectedDate;
    } else if (typeof selectedDate === 'string') {
      dateObj = new Date(selectedDate);
    } else {
      // Fallback to current date if invalid
      dateObj = new Date();
    }
    
    // Validate the date
    if (!isNaN(dateObj.getTime())) {
      onSelectDate(dateObj);
    } else {
      console.warn('Invalid date selected, using current date');
      onSelectDate(new Date());
    }
    onClose();
  };

  const handleClose = () => {
    setSelectedDate(currentDate);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Select Date</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <DatePicker
              value={selectedDate}
              onChange={(date) => {
                if (date) {
                  // Ensure date is a Date object (DatePicker might return string on web)
                  let dateObj: Date;
                  if (date instanceof Date) {
                    dateObj = date;
                  } else if (typeof date === 'string') {
                    dateObj = new Date(date);
                  } else {
                    return; // Invalid date, don't update
                  }
                  
                  // Validate the date before setting
                  if (!isNaN(dateObj.getTime())) {
                    setSelectedDate(dateObj);
                  }
                }
              }}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
            />
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
              onPress={handleSelect}
            >
              <Text style={[styles.buttonText, styles.submitButtonText]}>
                Select Date
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleClose}
            >
              <Text style={[styles.buttonText, styles.cancelButtonText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    padding: 16,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  button: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: "#222224",
  },
  cancelButton: {
    backgroundColor: "#ecedf0",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  submitButtonText: {
    color: "#fff",
  },
  cancelButtonText: {
    color: "#4b4b4d",
  },
});

