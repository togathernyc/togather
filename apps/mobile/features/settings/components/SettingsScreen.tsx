import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { SettingsForm } from "./SettingsForm";
import { TimezoneSection } from "./TimezoneSection";
import { NotificationPreferencesSection } from "./NotificationPreferencesSection";
import { LeaderToolsSection } from "./LeaderToolsSection";
import { QuickLinksSection } from "./QuickLinksSection";
import { BlockedUsersSection } from "./BlockedUsersSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { AppearanceSection } from "./AppearanceSection";
import { AppInfoSection } from "./AppInfoSection";

export function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <ScrollView style={styles.scrollView}>
      <View style={[styles.header, { paddingTop: insets.top + 20, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push("/(tabs)/profile");
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
      </View>

      <SettingsForm />
      <TimezoneSection />
      <AppearanceSection />
      <NotificationPreferencesSection />
      <LeaderToolsSection />
      <QuickLinksSection />
      <BlockedUsersSection />
      <AppInfoSection />
      <DeleteAccountSection />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "bold",
  },
});
