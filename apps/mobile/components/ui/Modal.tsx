import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal as RNModal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface CustomModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number | string;
  withoutCloseBtn?: boolean;
  contentPadding?: string;
  fixedHeight?: number | string;
}

export function CustomModal({
  visible,
  onClose,
  title,
  children,
  width = "90%",
  withoutCloseBtn = false,
  contentPadding = "24px",
  fixedHeight,
}: CustomModalProps) {
  const { colors } = useTheme();

  // Parse padding string to number
  const parsePadding = (padding: string) => {
    const parts = padding.split(" ");
    if (parts.length === 1) {
      const num = parseInt(parts[0]);
      return { top: num, right: num, bottom: num, left: num };
    }
    if (parts.length === 2) {
      const vertical = parseInt(parts[0]);
      const horizontal = parseInt(parts[1]);
      return {
        top: vertical,
        right: horizontal,
        bottom: vertical,
        left: horizontal,
      };
    }
    if (parts.length === 4) {
      return {
        top: parseInt(parts[0]),
        right: parseInt(parts[1]),
        bottom: parseInt(parts[2]),
        left: parseInt(parts[3]),
      };
    }
    return { top: 24, right: 24, bottom: 24, left: 24 };
  };

  const padding = parsePadding(contentPadding);

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[styles.backdrop, { backgroundColor: colors.overlay }]} />
        </TouchableWithoutFeedback>
        <View style={styles.modalContainer}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.surface },
              // React Native accepts both numeric and percent-string widths
              // (e.g. "90%"). The previous native branch used a `typeof
              // === "number"` guard and silently dropped string widths to
              // `undefined`, which collapsed the modal to its intrinsic
              // content width and produced a narrow column on iOS — visible
              // in the Add People / Rename Chat sheets that take the default
              // "90%" width. Pass the width through directly on every
              // platform; cast for TS because RN's style types disallow
              // percent strings even though the runtime supports them.
              {
                width: width as any,
                ...(fixedHeight !== undefined
                  ? { height: fixedHeight as any }
                  : {}),
              },
              Platform.select({
                web: {
                  boxShadow: "0px 4px 20px rgba(0, 0, 0, 0.15)",
                  maxHeight: "90vh" as any,
                },
                default: {
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 20,
                  elevation: 5,
                  maxHeight: "90%" as any,
                },
              }),
            ]}
          >
            {title && (
              <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                {!withoutCloseBtn && (
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={onClose}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={24} color={colors.icon} />
                  </TouchableOpacity>
                )}
              </View>
            )}
            {!title && !withoutCloseBtn && (
              <TouchableOpacity
                style={[styles.closeButtonAbsolute, { backgroundColor: colors.modalCloseBackground }]}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={colors.icon} />
              </TouchableOpacity>
            )}
            <ScrollView
              style={[
                styles.content,
                {
                  paddingTop: padding.top,
                  paddingRight: padding.right,
                  paddingBottom: padding.bottom,
                  paddingLeft: padding.left,
                },
              ]}
              contentContainerStyle={styles.contentContainer}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  modalContent: {
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonAbsolute: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 10,
    padding: 4,
    borderRadius: 12,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
});
