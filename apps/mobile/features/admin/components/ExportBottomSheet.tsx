/**
 * ExportBottomSheet - Animated bottom sheet for CSV export options
 *
 * Provides three export methods:
 * - Copy to clipboard
 * - Save to files (via share sheet)
 * - Email to self
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Animated,
  Platform,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  copyToClipboard,
  saveAndShareCSV,
  emailCSV,
} from "../utils/csvExport";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface ExportBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  csvContent: string;
  filename: string;
  userEmail?: string;
  title?: string;
}

type ExportAction = "copy" | "download" | "email";

export function ExportBottomSheet({
  visible,
  onClose,
  csvContent,
  filename,
  userEmail,
  title = "Export Data",
}: ExportBottomSheetProps) {
  const { primaryColor } = useCommunityTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [loadingAction, setLoadingAction] = useState<ExportAction | null>(null);
  const [successAction, setSuccessAction] = useState<ExportAction | null>(null);

  useEffect(() => {
    if (visible) {
      // Reset state when opening
      setLoadingAction(null);
      setSuccessAction(null);
      slideAnim.setValue(SCREEN_HEIGHT);
      fadeAnim.setValue(0);

      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  const handleCopy = async () => {
    setLoadingAction("copy");
    try {
      await copyToClipboard(csvContent);
      setSuccessAction("copy");
      setTimeout(() => {
        setSuccessAction(null);
        onClose();
      }, 1000);
    } catch (error) {
      console.error("Failed to copy:", error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDownload = async () => {
    setLoadingAction("download");
    try {
      await saveAndShareCSV(filename, csvContent);
      onClose();
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleEmail = async () => {
    if (!userEmail) return;

    setLoadingAction("email");
    try {
      const subject = `Export: ${filename.replace(".csv", "").replace(/_/g, " ")}`;
      const body = "Please find the exported data attached as a CSV file.";
      await emailCSV(filename, csvContent, userEmail, subject, body);
      onClose();
    } catch (error) {
      console.error("Failed to email:", error);
    } finally {
      setLoadingAction(null);
    }
  };

  const renderButton = (
    action: ExportAction,
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
    disabled?: boolean
  ) => {
    const isLoading = loadingAction === action;
    const isSuccess = successAction === action;
    const isDisabled = disabled || loadingAction !== null;

    return (
      <TouchableOpacity
        style={[
          styles.optionButton,
          isDisabled && styles.optionButtonDisabled,
          isSuccess && styles.optionButtonSuccess,
        ]}
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.7}
      >
        <View style={[styles.optionIcon, { backgroundColor: `${primaryColor}15` }]}>
          {isLoading ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : isSuccess ? (
            <Ionicons name="checkmark" size={22} color="#34C759" />
          ) : (
            <Ionicons name={icon} size={22} color={primaryColor} />
          )}
        </View>
        <Text style={[styles.optionLabel, isDisabled && styles.optionLabelDisabled]}>
          {isSuccess ? "Copied!" : label}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={isDisabled ? "#ccc" : "#999"}
        />
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.bottomSheet,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.content}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>Choose how to export</Text>

            <View style={styles.optionsContainer}>
              {renderButton("copy", "copy-outline", "Copy to Clipboard", handleCopy)}
              {renderButton("download", "download-outline", "Save to Files", handleDownload)}
              {renderButton(
                "email",
                "mail-outline",
                userEmail ? "Email to Me" : "Email (not available)",
                handleEmail,
                !userEmail
              )}
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    paddingHorizontal: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#D1D1D6",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  content: {
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 24,
  },
  optionsContainer: {
    width: "100%",
    gap: 12,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  optionButtonDisabled: {
    opacity: 0.5,
  },
  optionButtonSuccess: {
    backgroundColor: "#E8F5E9",
    borderColor: "#34C759",
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  optionLabelDisabled: {
    color: "#999",
  },
  cancelButton: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#666",
  },
});
