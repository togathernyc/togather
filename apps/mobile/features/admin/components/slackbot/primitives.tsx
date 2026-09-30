/**
 * Small building blocks shared by the Slack bot admin sections and editors.
 */
import React from "react";
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { styles } from "./styles";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const cardStyle = [styles.card, { backgroundColor: colors.surface }, style];
  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

/** The compact "+ Add" / "✎ Edit" pill used in section headers and cards. */
export function SmallButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { primaryColor } = useCommunityTheme();
  return (
    <TouchableOpacity
      style={[styles.smallButton, { backgroundColor: primaryColor }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={14} color="#fff" />
      <Text style={styles.smallButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

/**
 * A wrap-around row of selectable chips. Works for single select (pass
 * `isSelected` comparing to one value) and multi select (checking an array).
 */
export function ChipSelect<T extends string | number>({
  options,
  isSelected,
  onPress,
  activeColor,
  small,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  isSelected: (value: T) => boolean;
  onPress: (value: T) => void;
  activeColor?: (value: T) => string;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  return (
    <View style={styles.chipContainer}>
      {options.map(({ value, label }) => {
        const selected = isSelected(value);
        return (
          <TouchableOpacity
            key={String(value)}
            style={[
              styles.selectChip,
              small && styles.selectChipSmall,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              selected && {
                backgroundColor: activeColor?.(value) ?? primaryColor,
                borderColor: "transparent",
              },
            ]}
            onPress={() => onPress(value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text
              style={[
                styles.selectChipText,
                small && { fontSize: 13 },
                { color: selected ? "#fff" : colors.text },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Toggle `value` in or out of a list — for multi-select ChipSelects. */
export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Page-sheet modal with the Cancel / Title / Save header every editor uses.
 * Omit `onSave` for pickers that apply changes immediately.
 */
export function EditorModal({
  visible,
  title,
  onClose,
  onSave,
  closeLabel = "Cancel",
  scroll = true,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave?: () => void;
  closeLabel?: string;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.modalAction, { color: onSave ? colors.destructive : primaryColor }]}>
              {closeLabel}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {onSave ? (
            <TouchableOpacity onPress={onSave}>
              <Text style={[styles.modalAction, { color: primaryColor, fontWeight: "600", textAlign: "right" }]}>
                Save
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>
        {scroll ? (
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {children}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </Modal>
  );
}

export function EditorLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.editorLabel, { color: colors.textSecondary, marginTop: first ? 0 : 20 }]}>
      {children}
    </Text>
  );
}
