import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import {
  COMMON_TIMEZONES,
  getTimezoneAbbreviation,
  getTimezoneDisplayName,
} from "@togather/shared";
import type { Id } from "@services/api/convex";

export function TimezoneSection() {
  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, setIsPending] = useState(false);

  const userId = user?.id as Id<"users"> | undefined;
  const updateMutation = useAuthenticatedMutation(api.functions.users.update);

  const currentTimezone = user?.timezone || "America/New_York";
  const currentAbbreviation = getTimezoneAbbreviation(currentTimezone);

  const filteredTimezones = COMMON_TIMEZONES.filter(
    (tz) =>
      tz.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tz.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectTimezone = async (timezone: string) => {
    if (!userId) return;

    setIsPending(true);
    try {
      await updateMutation({ timezone });
      await refreshUser();
      setIsModalVisible(false);
    } catch (error) {
      console.error("Failed to update timezone:", error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Time Zone</Text>
      <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
        Events and meetings will be displayed in your selected time zone.
      </Text>

      <TouchableOpacity
        style={[styles.selector, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        onPress={() => setIsModalVisible(true)}
      >
        <View style={styles.selectorContent}>
          <Text style={[styles.selectorLabel, { color: colors.text }]}>
            {getTimezoneDisplayName(currentTimezone)}
          </Text>
          <Text style={[styles.selectorValue, { color: colors.textSecondary }]}>{currentAbbreviation}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.icon} />
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top, backgroundColor: colors.modalBackground }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setIsModalVisible(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Select Time Zone</Text>
            <View style={styles.closeButton} />
          </View>

          <View style={[styles.searchContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons
              name="search"
              size={20}
              color={colors.icon}
              style={styles.searchIcon}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search time zones..."
              placeholderTextColor={colors.inputPlaceholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {isPending && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.overlay }]}>
              <ActivityIndicator size="large" color={colors.link} />
            </View>
          )}

          <FlatList
            data={filteredTimezones}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.timezoneItem,
                  currentTimezone === item.value && { backgroundColor: colors.selectedBackground },
                ]}
                onPress={() => handleSelectTimezone(item.value)}
              >
                <View style={styles.timezoneItemContent}>
                  <Text
                    style={[
                      styles.timezoneLabel,
                      { color: colors.text },
                      currentTimezone === item.value && {
                        fontWeight: "600",
                        color: colors.link,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                  <Text style={[styles.timezoneOffset, { color: colors.textTertiary }]}>{item.offset}</Text>
                </View>
                {currentTimezone === item.value && (
                  <Ionicons name="checkmark" size={24} color={colors.link} />
                )}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.borderLight }]} />
            )}
            contentContainerStyle={styles.listContent}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  selector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
  },
  selectorContent: {
    flex: 1,
  },
  selectorLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 4,
  },
  selectorValue: {
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  timezoneItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  timezoneItemContent: {
    flex: 1,
  },
  timezoneLabel: {
    fontSize: 16,
    marginBottom: 2,
  },
  timezoneOffset: {
    fontSize: 13,
  },
  separator: {
    height: 1,
    marginLeft: 20,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
});
