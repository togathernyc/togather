import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SearchBar } from "@components/ui/SearchBar";
import { GuestCounter } from "./GuestCounter";
import { MemberItem } from "./MemberItem";

interface AttendanceEditModeProps {
  note: string;
  onUpdateNote: (note: string) => void;
  anonymousGuestCount: number;
  onIncrementAnonymousGuests: () => void;
  onDecrementAnonymousGuests: () => void;
  onAddNamedGuest: () => void;
  // Existing named guests (from database) that can be removed
  existingNamedGuests?: any[];
  onRemoveNamedGuest?: (guestId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onFilterPress: () => void;
  filteredMembers: any[];
  attendance: string[];
  currentUserId?: string;
  onToggleAttendance: (memberId: string) => void;
  isLoading: boolean;
  onSubmitPress: () => void;
}

export function AttendanceEditMode({
  note,
  onUpdateNote,
  anonymousGuestCount,
  onIncrementAnonymousGuests,
  onDecrementAnonymousGuests,
  onAddNamedGuest,
  existingNamedGuests = [],
  onRemoveNamedGuest,
  searchQuery,
  onSearchChange,
  onFilterPress,
  filteredMembers,
  attendance,
  currentUserId,
  onToggleAttendance,
  isLoading,
  onSubmitPress,
}: AttendanceEditModeProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {/* Scrollable content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Note Input */}
        <View style={styles.noteSection}>
          <TextInput
            style={styles.noteInput}
            placeholder="Add a note..."
            value={note}
            onChangeText={onUpdateNote}
            multiline
            numberOfLines={3}
            placeholderTextColor="#999"
          />
        </View>

        {/* Guests Section */}
        <View style={styles.guestsSection}>
          <Text style={styles.sectionLabel}>Guests</Text>

          <GuestCounter
            count={anonymousGuestCount}
            onIncrement={onIncrementAnonymousGuests}
            onDecrement={onDecrementAnonymousGuests}
            label="Anonymous Guests"
          />

          {/* Show existing named guests with remove option */}
          {existingNamedGuests.length > 0 && (
            <View style={styles.existingGuestsSection}>
              <Text style={styles.existingGuestsLabel}>Named Guests</Text>
              {existingNamedGuests.map((guest: any) => (
                <View key={guest.id} style={styles.existingGuestItem}>
                  <View style={styles.guestIconContainer}>
                    <Ionicons name="person" size={18} color="#666" />
                  </View>
                  <Text style={styles.existingGuestName}>
                    {guest.first_name} {guest.last_name || ""}
                  </Text>
                  {onRemoveNamedGuest && (
                    <TouchableOpacity
                      style={styles.removeGuestButton}
                      onPress={() => onRemoveNamedGuest(guest.id)}
                    >
                      <Ionicons name="close-circle" size={22} color="#F56848" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.addGuestButton}
            onPress={onAddNamedGuest}
          >
            <Ionicons name="add-circle-outline" size={20} color="#333" />
            <Text style={styles.addGuestButtonText}>Add Named Guest</Text>
          </TouchableOpacity>
        </View>

        {/* Members Section */}
        <View style={styles.membersSection}>
          <Text style={styles.sectionLabel}>Members</Text>

          {/* Search and Filter */}
          <View style={styles.searchFilterRow}>
            <View style={styles.searchContainer}>
              <SearchBar
                placeholder="Search"
                value={searchQuery}
                onChangeText={onSearchChange}
              />
            </View>
            <TouchableOpacity style={styles.filterButton} onPress={onFilterPress}>
              <Text style={styles.filterButtonText}>Filter</Text>
              <Ionicons name="chevron-down" size={16} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Members List */}
          <View style={styles.membersList}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#666" />
                <Text style={styles.loadingText}>Loading members...</Text>
              </View>
            ) : filteredMembers.length > 0 ? (
              filteredMembers
                // Filter out members without valid user IDs (can't track attendance without them)
                .filter((member: any) => member.user?._id)
                .map((member: any) => {
                  const attendanceIds = attendance || [];
                  // Use Convex user ID from nested user object (must match useAttendanceSubmission)
                  const memberId = member.user._id;
                  const isAttended = attendanceIds.includes(memberId);
                  const isCurrentUser = currentUserId === memberId;

                  return (
                    <MemberItem
                      key={memberId}
                      member={{ ...member, id: memberId }}
                      isAttended={isAttended}
                      isCurrentUser={isCurrentUser}
                      onToggleAttendance={onToggleAttendance}
                      showCheckbox={true}
                    />
                  );
                })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No members found</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Fixed Submit Button at bottom */}
      <View style={[styles.submitButtonContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity style={styles.submitButton} onPress={onSubmitPress}>
          <Text style={styles.submitButtonText}>Submit Attendance</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Space for the fixed submit button
  },
  noteSection: {
    marginBottom: 24,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
    minHeight: 80,
    textAlignVertical: "top",
  },
  guestsSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  existingGuestsSection: {
    marginTop: 12,
  },
  existingGuestsLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#999",
    marginBottom: 8,
  },
  existingGuestItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 8,
  },
  guestIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  existingGuestName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  removeGuestButton: {
    padding: 4,
  },
  addGuestButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
  },
  addGuestButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  membersSection: {
    marginBottom: 24,
  },
  searchFilterRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  searchContainer: {
    flex: 1,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    gap: 4,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  membersList: {
    marginTop: 8,
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: "#999",
  },
  submitButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  submitButton: {
    backgroundColor: "#222224",
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
});

