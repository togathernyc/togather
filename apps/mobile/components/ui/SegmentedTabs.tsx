/**
 * SegmentedTabs
 *
 * A small, reusable segmented control / tab switcher for swapping between
 * 2–4 options (e.g. "Run sheet" / "Tasks"). Pill-shaped track with an
 * elevated "thumb" behind the active option.
 *
 * Layout pattern: each option's Pressable wraps a static-styled inner View —
 * RN-Web silently drops layout styles on a Pressable's function-style `style`
 * prop, so all padding/flex lives on the inner View's StyleSheet style.
 * See features/scheduling/components/TeamChannelToggle.tsx for the same idiom.
 */
import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@hooks/useTheme";

export type SegmentedTabOption<T extends string = string> = {
  key: T;
  label: string;
};

export interface SegmentedTabsProps<T extends string = string> {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  style,
  accessibilityLabel,
}: SegmentedTabsProps<T>) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        style,
      ]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
          >
            {/* Inner View holds all layout — see file header re: RN-Web. */}
            <View
              style={[
                styles.option,
                selected && [styles.optionActive, { backgroundColor: colors.surface }],
              ]}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: selected ? colors.text : colors.textSecondary,
                    fontWeight: selected ? "700" : "600",
                  },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: 3,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  optionActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  label: {
    fontSize: 13,
  },
});
