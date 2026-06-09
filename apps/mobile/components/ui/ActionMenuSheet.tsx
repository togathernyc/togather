/**
 * ActionMenuSheet
 *
 * A small cross-platform action menu (a list of buttons over a dim backdrop).
 * Used as the web fallback for `ActionSheetIOS` menus, which are iOS-only — on
 * web the native action sheet never shows, so an imperative ⋯ menu silently
 * does nothing. Callers own the `visible` state and pass the actions.
 */
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@hooks/useTheme";

export type MenuAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

export function ActionMenuSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {title ? (
            <Text style={[styles.title, { color: colors.textSecondary }]} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {actions.map((action, i) => (
            <Pressable
              key={i}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              style={[styles.action, { borderTopColor: colors.border }]}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.actionText,
                  { color: action.destructive ? colors.destructive : colors.text },
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            style={[styles.action, styles.cancel, { borderTopColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.actionText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  action: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancel: { marginTop: 0 },
  actionText: { fontSize: 16, fontWeight: "600" },
});
