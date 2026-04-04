import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

interface SeriesLinkModalProps {
  visible: boolean;
  onClose: () => void;
  meetingId: string;
  groupId: string;
  currentSeriesId?: string | null;
  currentSeriesName?: string | null;
}

export function SeriesLinkModal({
  visible,
  onClose,
  meetingId,
  groupId,
  currentSeriesId,
  currentSeriesName,
}: SeriesLinkModalProps) {
  const { colors } = useTheme();
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addToSeries = useAuthenticatedMutation(api.functions.eventSeries.addMeetingToSeries);
  const removeFromSeries = useAuthenticatedMutation(api.functions.eventSeries.removeMeetingFromSeries);
  const createFromMeetings = useAuthenticatedMutation(api.functions.eventSeries.createSeriesFromMeetings);

  // Fetch existing series for this group
  const existingSeries = useQuery(
    api.functions.eventSeries.listByGroup,
    visible && !currentSeriesId
      ? { groupId: groupId as Id<"groups">, status: "active" }
      : "skip"
  );

  const handleAddToExistingSeries = async (seriesId: string) => {
    setIsSubmitting(true);
    try {
      await addToSeries({
        meetingId: meetingId as Id<"meetings">,
        seriesId: seriesId as Id<"eventSeries">,
      });
      onClose();
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to add to series"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateNewSeries = async () => {
    if (!newSeriesName.trim()) return;
    setIsSubmitting(true);
    try {
      await createFromMeetings({
        groupId: groupId as Id<"groups">,
        name: newSeriesName.trim(),
        meetingIds: [meetingId as Id<"meetings">],
      });
      setNewSeriesName("");
      setIsCreatingNew(false);
      onClose();
    } catch (error: any) {
      Alert.alert("Error", formatError(error, "Failed to create series"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveFromSeries = async () => {
    Alert.alert(
      "Remove from Series",
      `Remove this event from "${currentSeriesName}"? The event won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await removeFromSeries({
                meetingId: meetingId as Id<"meetings">,
              });
              onClose();
            } catch (error: any) {
              Alert.alert("Error", formatError(error, "Failed to remove from series"));
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {currentSeriesId ? "Event Series" : "Add to Series"}
          </Text>
          <View style={styles.closeButton} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {currentSeriesId ? (
            // Already in a series — show remove option
            <View>
              <View style={[styles.currentSeriesCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="layers-outline" size={24} color={colors.textSecondary} />
                <View style={styles.currentSeriesInfo}>
                  <Text style={[styles.currentSeriesLabel, { color: colors.textSecondary }]}>Current Series</Text>
                  <Text style={[styles.currentSeriesName, { color: colors.text }]}>{currentSeriesName}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.removeButton, { borderColor: colors.error }]}
                onPress={handleRemoveFromSeries}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <>
                    <Ionicons name="unlink-outline" size={18} color={colors.error} />
                    <Text style={[styles.removeButtonText, { color: colors.error }]}>
                      Remove from Series
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            // Not in a series — show options to add
            <View>
              {/* Existing series list */}
              {existingSeries === undefined ? (
                <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginTop: 20 }} />
              ) : existingSeries && existingSeries.length > 0 ? (
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>EXISTING SERIES</Text>
                  {existingSeries.map((s) => (
                    <TouchableOpacity
                      key={s._id}
                      style={[styles.seriesOption, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      onPress={() => handleAddToExistingSeries(s._id)}
                      disabled={isSubmitting}
                    >
                      <View style={styles.seriesOptionInfo}>
                        <Text style={[styles.seriesOptionName, { color: colors.text }]}>{s.name}</Text>
                        <Text style={[styles.seriesOptionCount, { color: colors.textSecondary }]}>
                          {s.meetingCount} event{s.meetingCount !== 1 ? "s" : ""}
                        </Text>
                      </View>
                      <Ionicons name="add-circle-outline" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {/* Create new series */}
              <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: existingSeries && existingSeries.length > 0 ? 24 : 0 }]}>
                {existingSeries && existingSeries.length > 0 ? "OR CREATE NEW" : "CREATE SERIES"}
              </Text>

              {isCreatingNew ? (
                <View style={[styles.createNewForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
                    placeholder="Series name (e.g., Movie Night)"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={newSeriesName}
                    onChangeText={setNewSeriesName}
                    autoFocus
                  />
                  <View style={styles.createNewActions}>
                    <TouchableOpacity
                      style={[styles.cancelButton, { borderColor: colors.border }]}
                      onPress={() => {
                        setIsCreatingNew(false);
                        setNewSeriesName("");
                      }}
                    >
                      <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.createButton, { opacity: newSeriesName.trim() ? 1 : 0.5 }]}
                      onPress={handleCreateNewSeries}
                      disabled={!newSeriesName.trim() || isSubmitting}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.createButtonText}>Create & Add</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.newSeriesButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => setIsCreatingNew(true)}
                >
                  <Ionicons name="add" size={20} color={colors.text} />
                  <Text style={[styles.newSeriesButtonText, { color: colors.text }]}>New Series</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 36,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  currentSeriesCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
  },
  currentSeriesInfo: {
    flex: 1,
  },
  currentSeriesLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 2,
  },
  currentSeriesName: {
    fontSize: 17,
    fontWeight: "600",
  },
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  seriesOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  seriesOptionInfo: {
    flex: 1,
  },
  seriesOptionName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  seriesOptionCount: {
    fontSize: 13,
  },
  createNewForm: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  createNewActions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  createButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#007AFF",
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  newSeriesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: 8,
  },
  newSeriesButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
