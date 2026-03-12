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
import { SettingsForm } from "./SettingsForm";
import { TimezoneSection } from "./TimezoneSection";
import { NotificationPreferencesSection } from "./NotificationPreferencesSection";
import { LeaderToolsSection } from "./LeaderToolsSection";
import { QuickLinksSection } from "./QuickLinksSection";
import { BlockedUsersSection } from "./BlockedUsersSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { AppInfoSection } from "./AppInfoSection";

export function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView style={styles.scrollView}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
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
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <SettingsForm />
      <TimezoneSection />
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
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
});
