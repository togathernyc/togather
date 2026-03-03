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
import {
  COMMON_TIMEZONES,
  getTimezoneAbbreviation,
  getTimezoneDisplayName,
} from "@togather/shared";
import type { Id } from "@services/api/convex";

export function TimezoneSection() {
  const { user, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
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
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Time Zone</Text>
      <Text style={styles.sectionDescription}>
        Events and meetings will be displayed in your selected time zone.
      </Text>

      <TouchableOpacity
        style={styles.selector}
        onPress={() => setIsModalVisible(true)}
      >
        <View style={styles.selectorContent}>
          <Text style={styles.selectorLabel}>
            {getTimezoneDisplayName(currentTimezone)}
          </Text>
          <Text style={styles.selectorValue}>{currentAbbreviation}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setIsModalVisible(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select Time Zone</Text>
            <View style={styles.closeButton} />
          </View>

          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color="#666"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search time zones..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color="#999" />
              </TouchableOpacity>
            )}
          </View>

          {isPending && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#007AFF" />
            </View>
          )}

          <FlatList
            data={filteredTimezones}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.timezoneItem,
                  currentTimezone === item.value && styles.timezoneItemSelected,
                ]}
                onPress={() => handleSelectTimezone(item.value)}
              >
                <View style={styles.timezoneItemContent}>
                  <Text
                    style={[
                      styles.timezoneLabel,
                      currentTimezone === item.value &&
                        styles.timezoneLabelSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                  <Text style={styles.timezoneOffset}>{item.offset}</Text>
                </View>
                {currentTimezone === item.value && (
                  <Ionicons name="checkmark" size={24} color="#007AFF" />
                )}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    backgroundColor: "#fff",
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  selector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8f8f8",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  selectorContent: {
    flex: 1,
  },
  selectorLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  selectorValue: {
    fontSize: 14,
    color: "#666",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
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
    color: "#333",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
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
  timezoneItemSelected: {
    backgroundColor: "#f0f8ff",
  },
  timezoneItemContent: {
    flex: 1,
  },
  timezoneLabel: {
    fontSize: 16,
    color: "#333",
    marginBottom: 2,
  },
  timezoneLabelSelected: {
    fontWeight: "600",
    color: "#007AFF",
  },
  timezoneOffset: {
    fontSize: 13,
    color: "#999",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginLeft: 20,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
});
