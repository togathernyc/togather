/**
 * Shared layout primitives for the channel info screen and its picker
 * sub-screens. Keeps the DM-info aesthetic consistent across files:
 *
 *   - InfoHeader      - Top bar with back chevron + centered title
 *   - SectionHeader   - Small-caps gray section label
 *   - GroupCard       - Rounded surface card that hosts row children
 *   - PickerRow       - Two-line option row (label + consequence) with
 *                       trailing radio mark; used by join-mode / active-state
 *   - infoStyles      - Shared StyleSheet for all of the above + screens
 *
 * Theming reads from `useTheme().colors` so light/dark just works.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { useTheme } from "@hooks/useTheme";

type Colors = ReturnType<typeof useTheme>["colors"];

export function InfoHeader({
  title,
  onBack,
  colors,
  rightSlot,
}: {
  title: string;
  onBack: () => void;
  colors: Colors;
  rightSlot?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        infoStyles.headerBar,
        {
          paddingTop: insets.top,
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={infoStyles.headerInner}>
        <TouchableOpacity onPress={onBack} hitSlop={12} style={infoStyles.headerBackButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[infoStyles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={infoStyles.headerRightSlot}>{rightSlot ?? null}</View>
      </View>
    </View>
  );
}

export function SectionHeader({ colors, label }: { colors: Colors; label: string }) {
  return (
    <Text style={[infoStyles.sectionHeader, { color: colors.textSecondary }]}>
      {label.toUpperCase()}
    </Text>
  );
}

export function GroupCard({
  colors,
  children,
}: {
  colors: Colors;
  children: React.ReactNode;
}) {
  // Filter out null/false children before measuring count so dividers
  // only appear between actually-rendered rows.
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View
      style={[
        infoStyles.groupCard,
        { backgroundColor: colors.surfaceSecondary },
      ]}
    >
      {rows.map((child, idx) => {
        const dividerStyle =
          idx > 0
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              }
            : undefined;
        return (
          <View key={idx} style={dividerStyle}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

/**
 * One option in a picker sub-screen. Two lines of text on the left, a
 * radio-style mark on the right, full row pressable.
 */
export function PickerRow({
  colors,
  label,
  description,
  selected,
  disabled,
  onPress,
  primaryColor,
}: {
  colors: Colors;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  primaryColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        infoStyles.pickerRow,
        pressed && !disabled && { backgroundColor: colors.selectedBackground },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={infoStyles.pickerRowText}>
        <Text style={[infoStyles.pickerRowLabel, { color: colors.text }]}>
          {label}
        </Text>
        <Text
          style={[infoStyles.pickerRowDescription, { color: colors.textSecondary }]}
        >
          {description}
        </Text>
      </View>
      <View
        style={[
          infoStyles.radio,
          {
            borderColor: selected ? primaryColor : colors.border,
            backgroundColor: selected ? primaryColor : "transparent",
          },
        ]}
      >
        {selected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
      </View>
    </Pressable>
  );
}

export const infoStyles = StyleSheet.create({
  // ---- Header ---------------------------------------------------------------
  headerBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerBackButton: {
    padding: 4,
    marginRight: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerRightSlot: {
    minWidth: 36,
    alignItems: "flex-end",
  },

  // ---- Container / layout ---------------------------------------------------
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },

  // ---- Hero -----------------------------------------------------------------
  heroSection: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  heroAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarInitials: {
    fontSize: 36,
    fontWeight: "700",
    color: "#ffffff",
  },
  heroName: {
    marginTop: 16,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  heroPill: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroPillText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // ---- Sections / cards -----------------------------------------------------
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  sectionIntro: {
    paddingHorizontal: 20,
    marginBottom: 8,
    marginTop: -2,
    fontSize: 13,
    lineHeight: 18,
  },
  groupCard: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },

  // ---- Standalone solid CTA card (Open chat / Add people) -------------------
  ctaCard: {
    marginHorizontal: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 56,
  },
  ctaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },

  // ---- Generic action row inside a card -------------------------------------
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  actionRowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  actionRowValue: {
    fontSize: 14,
  },

  // ---- Member row -----------------------------------------------------------
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  memberRowText: {
    flex: 1,
    minWidth: 0,
  },
  memberRowName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberRowSubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },

  // ---- Picker rows ----------------------------------------------------------
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
  },
  pickerRowText: {
    flex: 1,
    minWidth: 0,
  },
  pickerRowLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  pickerRowDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  hintBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  hintBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },

  // ---- Modal (rename) -------------------------------------------------------
  modalCard: {
    flex: 1,
    paddingHorizontal: 16,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});

/**
 * Tiny shared loader for hooks that fetch the channel; keeps the various
 * info screens DRY when they need to wait for the channel to resolve.
 */
export function InfoLoading({ colors, indicatorColor }: { colors: Colors; indicatorColor: string }) {
  return (
    <View style={infoStyles.centered}>
      <Text style={[infoStyles.errorText, { color: colors.textSecondary }]}>Loading…</Text>
      {/* indicatorColor reserved for future spinner use */}
      {indicatorColor ? null : null}
    </View>
  );
}
