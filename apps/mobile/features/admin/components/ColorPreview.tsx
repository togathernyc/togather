/**
 * ColorPreview - Shows a preview of how primary and secondary colors will look in the app
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface ColorPreviewProps {
  primaryColor: string;
  secondaryColor: string;
}

export function ColorPreview({ primaryColor, secondaryColor }: ColorPreviewProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textSecondary }]}>Preview</Text>

      <View style={[styles.previewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Mock app header */}
        <View style={[styles.mockHeader, { backgroundColor: primaryColor }]}>
          <Text style={styles.mockHeaderText}>Community Name</Text>
        </View>

        {/* Mock content */}
        <View style={styles.mockContent}>
          {/* Tab bar preview */}
          <View style={[styles.mockTabBar, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.mockTab}>
              <Ionicons name="home" size={20} color={primaryColor} />
              <Text style={[styles.mockTabText, { color: primaryColor }]}>Home</Text>
            </View>
            <View style={styles.mockTab}>
              <Ionicons name="people-outline" size={20} color={colors.textTertiary} />
              <Text style={[styles.mockTabTextInactive, { color: colors.textTertiary }]}>Groups</Text>
            </View>
            <View style={styles.mockTab}>
              <Ionicons name="chatbubble-outline" size={20} color={colors.textTertiary} />
              <Text style={[styles.mockTabTextInactive, { color: colors.textTertiary }]}>Chat</Text>
            </View>
          </View>

          {/* Buttons preview */}
          <View style={styles.buttonsPreview}>
            <View style={[styles.mockPrimaryButton, { backgroundColor: primaryColor }]}>
              <Text style={styles.mockButtonText}>Primary Button</Text>
            </View>
            <View style={[styles.mockSecondaryButton, { borderColor: secondaryColor }]}>
              <Text style={[styles.mockSecondaryButtonText, { color: secondaryColor }]}>Secondary Button</Text>
            </View>
          </View>

          {/* Badge and accent elements */}
          <View style={styles.elementsPreview}>
            <View style={[styles.mockBadge, { backgroundColor: primaryColor }]}>
              <Text style={styles.mockBadgeText}>Badge</Text>
            </View>
            <View style={[styles.mockToggle, { backgroundColor: primaryColor }]}>
              <View style={[styles.mockToggleKnob, { backgroundColor: colors.surface }]} />
            </View>
            <View style={[styles.mockProgressBar, { backgroundColor: colors.border }]}>
              <View style={[styles.mockProgressFill, { backgroundColor: secondaryColor, width: '60%' }]} />
            </View>
          </View>

          {/* Link preview */}
          <View style={styles.linkPreview}>
            <Text style={[styles.mockText, { color: colors.text }]}>Tap </Text>
            <Text style={[styles.mockLink, { color: primaryColor }]}>this link</Text>
            <Text style={[styles.mockText, { color: colors.text }]}> to see the accent color.</Text>
          </View>
        </View>
      </View>

      {/* Color swatches legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: primaryColor }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Primary</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: secondaryColor }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>Secondary</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  previewCard: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  mockHeader: {
    padding: 12,
    alignItems: "center",
  },
  mockHeaderText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  mockContent: {
    padding: 12,
    gap: 16,
  },
  mockTabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  mockTab: {
    alignItems: "center",
    gap: 4,
  },
  mockTabText: {
    fontSize: 10,
    fontWeight: "600",
  },
  mockTabTextInactive: {
    fontSize: 10,
  },
  buttonsPreview: {
    flexDirection: "row",
    gap: 10,
  },
  mockPrimaryButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  mockButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  mockSecondaryButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  mockSecondaryButtonText: {
    fontSize: 11,
    fontWeight: "600",
  },
  elementsPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  mockBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  mockToggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: 2,
  },
  mockToggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  mockProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  mockProgressFill: {
    height: "100%",
    borderRadius: 3,
  },
  linkPreview: {
    flexDirection: "row",
    alignItems: "center",
  },
  mockText: {
    fontSize: 12,
  },
  mockLink: {
    fontSize: 12,
    fontWeight: "500",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendSwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  legendText: {
    fontSize: 12,
  },
});
