/**
 * CommunicationBotConfigModal - Configuration modal for Communication Bot
 *
 * Allows leaders to configure multiple automated messages with PCO position placeholders.
 * Messages can include placeholders like {{MANHATTAN > WORSHIP > Worship Leader}}
 * that will be resolved to @mention actual team members.
 *
 * Features:
 * - Multiple scheduled messages support
 * - Message textarea with autocomplete for PCO positions
 * - Schedule picker (day of week + time) per message
 * - Target channel selector per message
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useAction, useQuery } from "convex/react";
import { api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery } from "@services/api/convex";
import { generateId } from "../utils/generateId";

// Schedule days
const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

// Single message configuration
interface ScheduledMessage {
  id: string;
  message: string;
  schedule: {
    dayOfWeek: number;
    hour: number;
    minute: number;
  };
  targetChannelSlug: string;
  enabled: boolean;
}

// Full bot config with multiple messages
interface CommunicationBotConfig {
  messages: ScheduledMessage[];
}

// Legacy single-message config for backward compatibility
interface LegacyCommunicationBotConfig {
  message: string;
  schedule: {
    dayOfWeek: number;
    hour: number;
    minute: number;
  };
  targetChannelSlug: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  groupId: Id<"groups">;
  initialConfig?: CommunicationBotConfig | LegacyCommunicationBotConfig;
  onSave: (config: CommunicationBotConfig) => Promise<void>;
}

interface PcoPosition {
  serviceTypeName: string | null;
  teamName: string | null;
  positionName: string;
  displayName: string;
}

// Check if config is legacy format
function isLegacyConfig(
  config: CommunicationBotConfig | LegacyCommunicationBotConfig
): config is LegacyCommunicationBotConfig {
  return "message" in config && typeof config.message === "string";
}

// Convert legacy config to new format
function migrateConfig(
  config: CommunicationBotConfig | LegacyCommunicationBotConfig | undefined
): CommunicationBotConfig {
  if (!config) {
    return { messages: [] };
  }
  if (isLegacyConfig(config)) {
    // Migrate single message to array
    if (config.message && config.message.trim()) {
      return {
        messages: [
          {
            id: generateId(),
            message: config.message,
            schedule: config.schedule || { dayOfWeek: 6, hour: 9, minute: 0 },
            targetChannelSlug: config.targetChannelSlug || "leaders",
            enabled: true,
          },
        ],
      };
    }
    return { messages: [] };
  }
  // Validate new format has messages array
  if (!config.messages || !Array.isArray(config.messages)) {
    return { messages: [] };
  }
  return config;
}

export function CommunicationBotConfigModal({
  visible,
  onClose,
  groupId,
  initialConfig,
  onSave,
}: Props) {
  const { primaryColor } = useCommunityTheme();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  // Config state - array of messages
  const [config, setConfig] = useState<CommunicationBotConfig>({ messages: [] });
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Editing state
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);

  // Fetch group to get communityId
  const groupData = useQuery(
    api.functions.groups.index.getById,
    visible && groupId ? { groupId } : "skip"
  );

  // Fetch channels for channel selection
  const channelsData = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    visible && groupId ? { groupId, includeArchived: false } : "skip"
  );

  // Fetch available positions from PCO
  const getPositions = useAction(
    api.functions.pcoServices.actions.getAvailablePositions
  );
  const sendCommunicationNow = useAction(
    api.functions.groupBots.sendCommunicationNow
  );
  const [positions, setPositions] = useState<PcoPosition[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [sendingMessageIds, setSendingMessageIds] = useState<Set<string>>(new Set());

  // Reset form when modal opens with new config
  useEffect(() => {
    if (visible) {
      const migratedConfig = migrateConfig(initialConfig);
      setConfig(migratedConfig);
      setIsDirty(false);
      setEditingMessage(null);
    }
  }, [visible, initialConfig]);

  // Load positions when modal opens and we have the community ID
  useEffect(() => {
    if (visible && token && groupData?.communityId) {
      loadPositions();
    }
  }, [visible, token, groupData?.communityId]);

  const loadPositions = async () => {
    if (!token || !groupData?.communityId) return;
    setLoadingPositions(true);
    try {
      const result = await getPositions({
        token,
        communityId: groupData.communityId,
      });
      const flatPositions: PcoPosition[] = result.map((pos) => ({
        serviceTypeName: pos.serviceTypeName,
        teamName: pos.teamName,
        positionName: pos.name,
        displayName: pos.displayName,
      }));
      setPositions(flatPositions);
    } catch (error) {
      console.error("Failed to load positions:", error);
    } finally {
      setLoadingPositions(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(config);
      onClose();
    } catch (error) {
      console.error("Failed to save:", error);
      Alert.alert("Error", "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMessage = () => {
    const newMessage: ScheduledMessage = {
      id: generateId(),
      message: "",
      schedule: { dayOfWeek: 6, hour: 9, minute: 0 },
      targetChannelSlug: "leaders",
      enabled: true,
    };
    setEditingMessage(newMessage);
  };

  const handleEditMessage = (message: ScheduledMessage) => {
    setEditingMessage({ ...message });
  };

  const handleDeleteMessage = (messageId: string) => {
    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this scheduled message?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setConfig({
              messages: config.messages.filter((m) => m.id !== messageId),
            });
            setIsDirty(true);
          },
        },
      ]
    );
  };

  const handleToggleMessage = (messageId: string) => {
    setConfig({
      messages: config.messages.map((m) =>
        m.id === messageId ? { ...m, enabled: !m.enabled } : m
      ),
    });
    setIsDirty(true);
  };

  const handleSendNow = (message: ScheduledMessage) => {
    if (!message.message.trim()) {
      Alert.alert("Empty Message", "This message has no content to send.");
      return;
    }
    Alert.alert(
      "Send Now?",
      "This will send this message immediately to the channel.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: async () => {
            if (!token || !groupId) return;
            setSendingMessageIds((prev) => new Set(prev).add(message.id));
            try {
              const result = await sendCommunicationNow({
                token,
                groupId,
                message: message.message,
                targetChannelSlug: message.targetChannelSlug,
              });
              if (result.success) {
                Alert.alert("Sent", "Message sent successfully.");
              } else {
                Alert.alert("Error", result.error || "Failed to send message.");
              }
            } catch (error) {
              Alert.alert("Error", "Failed to send message. Please try again.");
            } finally {
              setSendingMessageIds((prev) => {
                const next = new Set(prev);
                next.delete(message.id);
                return next;
              });
            }
          },
        },
      ]
    );
  };

  const handleSaveMessage = (message: ScheduledMessage) => {
    const existingIndex = config.messages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      // Update existing
      const newMessages = [...config.messages];
      newMessages[existingIndex] = message;
      setConfig({ messages: newMessages });
    } else {
      // Add new
      setConfig({ messages: [...config.messages, message] });
    }
    setEditingMessage(null);
    setIsDirty(true);
  };

  // Get channel name for display
  const getChannelName = (slug: string) => {
    const channel = channelsData?.find((ch) => ch.slug === slug);
    if (channel) {
      return channel.channelType === "main"
        ? "General"
        : channel.channelType === "leaders"
          ? "Leaders"
          : channel.name;
    }
    return slug === "leaders" ? "Leaders" : slug === "general" ? "General" : slug;
  };

  // Get day label for display
  const getDayLabel = (dayOfWeek: number) => {
    return DAYS_OF_WEEK.find((d) => d.value === dayOfWeek)?.short || "?";
  };

  // Format time for display
  const formatTime = (hour: number, minute: number) => {
    const h = hour % 12 || 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `${h}:${minute.toString().padStart(2, "0")} ${ampm}`;
  };

  // Channel options
  const channelOptions = (channelsData ?? [])
    .filter((ch) => !ch.isArchived)
    .map((ch) => ({
      slug: ch.slug,
      name:
        ch.channelType === "main"
          ? "General"
          : ch.channelType === "leaders"
            ? "Leaders"
            : ch.name,
    }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: "#f5f5f5" }]}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerIcon}>{"💬"}</Text>
            <Text style={styles.headerTitle}>Communication Bot</Text>
          </View>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <ActivityIndicator size="small" color={primaryColor} />
            ) : (
              <Text
                style={[
                  styles.saveButtonText,
                  { color: primaryColor },
                  !isDirty && styles.saveButtonTextDisabled,
                ]}
              >
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Info Text */}
          <Text style={styles.infoText}>
            Schedule automated messages to be sent to group channels. Use {"{{ }}"}
            to mention PCO team positions.
          </Text>

          {/* Messages List */}
          <View style={styles.messagesList}>
            {config.messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
                <Text style={styles.emptyTitle}>No scheduled messages</Text>
                <Text style={styles.emptyText}>
                  Add a message to automatically send at a scheduled time.
                </Text>
              </View>
            ) : (
              config.messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.messageCard,
                    !message.enabled && styles.messageCardDisabled,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.messageContent}
                    onPress={() => handleEditMessage(message)}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        !message.enabled && styles.messageTextDisabled,
                      ]}
                      numberOfLines={2}
                    >
                      {message.message || "(Empty message)"}
                    </Text>
                    <View style={styles.messageInfo}>
                      <View style={styles.messageBadge}>
                        <Ionicons name="calendar-outline" size={12} color="#666" />
                        <Text style={styles.messageBadgeText}>
                          {getDayLabel(message.schedule.dayOfWeek)} at{" "}
                          {formatTime(message.schedule.hour, message.schedule.minute)}
                        </Text>
                      </View>
                      <View style={styles.messageBadge}>
                        <Ionicons name="chatbubble-outline" size={12} color="#666" />
                        <Text style={styles.messageBadgeText}>
                          {getChannelName(message.targetChannelSlug)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.messageActions}>
                    <TouchableOpacity
                      style={styles.toggleButton}
                      onPress={() => handleToggleMessage(message.id)}
                    >
                      <Ionicons
                        name={message.enabled ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={message.enabled ? primaryColor : "#ccc"}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sendNowButton}
                      onPress={() => handleSendNow(message)}
                      disabled={sendingMessageIds.has(message.id)}
                    >
                      {sendingMessageIds.has(message.id) ? (
                        <ActivityIndicator size="small" color={primaryColor} />
                      ) : (
                        <Ionicons name="send-outline" size={18} color={primaryColor} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteMessage(message.id)}
                    >
                      <Ionicons name="trash-outline" size={20} color="#e74c3c" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Add Message Button */}
          <TouchableOpacity
            style={[styles.addButton, { borderColor: primaryColor }]}
            onPress={handleAddMessage}
          >
            <Ionicons name="add-circle-outline" size={20} color={primaryColor} />
            <Text style={[styles.addButtonText, { color: primaryColor }]}>
              Add Scheduled Message
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Message Editor Modal */}
      {editingMessage && (
        <MessageEditorModal
          visible={!!editingMessage}
          message={editingMessage}
          onClose={() => setEditingMessage(null)}
          onSave={handleSaveMessage}
          positions={positions}
          loadingPositions={loadingPositions}
          channelOptions={channelOptions}
          primaryColor={primaryColor}
        />
      )}
    </Modal>
  );
}

// Separate component for editing individual messages
interface MessageEditorModalProps {
  visible: boolean;
  message: ScheduledMessage;
  onClose: () => void;
  onSave: (message: ScheduledMessage) => void;
  positions: PcoPosition[];
  loadingPositions: boolean;
  channelOptions: { slug: string; name: string }[];
  primaryColor: string;
}

function MessageEditorModal({
  visible,
  message: initialMessage,
  onClose,
  onSave,
  positions,
  loadingPositions,
  channelOptions,
  primaryColor,
}: MessageEditorModalProps) {
  const insets = useSafeAreaInsets();

  // Form state
  const [message, setMessage] = useState(initialMessage.message);
  const [schedule, setSchedule] = useState(initialMessage.schedule);
  const [targetChannelSlug, setTargetChannelSlug] = useState(
    initialMessage.targetChannelSlug
  );

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const textInputRef = useRef<TextInput>(null);

  // Time picker state
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempTimeDate, setTempTimeDate] = useState<Date | null>(null);

  // Handle text change and detect {{ trigger
  const handleTextChange = (text: string) => {
    setMessage(text);

    const beforeCursor = text.substring(
      0,
      cursorPosition + (text.length - message.length)
    );
    const lastTwoChars = beforeCursor.slice(-2);

    if (lastTwoChars === "{{") {
      setShowAutocomplete(true);
      setAutocompleteFilter("");
    } else if (showAutocomplete) {
      const openBraceIndex = beforeCursor.lastIndexOf("{{");
      if (openBraceIndex !== -1) {
        const filterText = beforeCursor.substring(openBraceIndex + 2);
        if (filterText.includes("}}")) {
          setShowAutocomplete(false);
        } else {
          setAutocompleteFilter(filterText);
        }
      } else {
        setShowAutocomplete(false);
      }
    }
  };

  const handleSelectionChange = useCallback((event: any) => {
    setCursorPosition(event.nativeEvent.selection.end);
  }, []);

  // Insert selected position into message
  const insertPosition = (position: PcoPosition) => {
    const beforeCursor = message.substring(0, cursorPosition);
    const openBraceIndex = beforeCursor.lastIndexOf("{{");

    if (openBraceIndex !== -1) {
      const before = message.substring(0, openBraceIndex);
      const after = message.substring(cursorPosition);
      const placeholder = `{{${position.displayName}}}`;

      const newMessage = before + placeholder + after;
      setMessage(newMessage);

      const newPosition = before.length + placeholder.length;
      setCursorPosition(newPosition);
    }

    setShowAutocomplete(false);
  };

  // Filter positions based on input
  const filteredPositions = positions.filter((p) =>
    p.displayName.toLowerCase().includes(autocompleteFilter.toLowerCase())
  );

  const handleSave = () => {
    if (!message.trim()) {
      Alert.alert("Error", "Please enter a message");
      return;
    }
    onSave({
      ...initialMessage,
      message,
      schedule,
      targetChannelSlug,
    });
  };

  // Time picker helpers
  const getTimeAsDate = () => {
    const date = new Date();
    date.setHours(schedule.hour, schedule.minute, 0, 0);
    return date;
  };

  const handleTimePress = () => {
    setTempTimeDate(getTimeAsDate());
    setShowTimePicker(true);
  };

  const handleTimeChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date
  ) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }

    if (event.type === "dismissed") {
      setShowTimePicker(false);
      setTempTimeDate(null);
      return;
    }

    if (selectedDate) {
      if (Platform.OS === "ios") {
        setTempTimeDate(selectedDate);
      } else {
        setSchedule({
          ...schedule,
          hour: selectedDate.getHours(),
          minute: selectedDate.getMinutes(),
        });
      }
    }
  };

  const handleTimeConfirm = () => {
    if (tempTimeDate) {
      setSchedule({
        ...schedule,
        hour: tempTimeDate.getHours(),
        minute: tempTimeDate.getMinutes(),
      });
    }
    setShowTimePicker(false);
    setTempTimeDate(null);
  };

  const handleTimeCancel = () => {
    setShowTimePicker(false);
    setTempTimeDate(null);
  };

  const formatTime24h = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: "#f5f5f5" }]}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="chevron-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>
              {initialMessage.message ? "Edit Message" : "New Message"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={!message.trim()}
          >
            <Text
              style={[
                styles.saveButtonText,
                { color: primaryColor },
                !message.trim() && styles.saveButtonTextDisabled,
              ]}
            >
              Done
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Message Input */}
          <View style={styles.section}>
            <Text style={styles.label}>Message</Text>
            <Text style={styles.hint}>
              Type {"{{ "} to insert PCO position mentions
            </Text>
            <View style={styles.textInputContainer}>
              <TextInput
                ref={textInputRef}
                style={styles.textArea}
                value={message}
                onChangeText={handleTextChange}
                onSelectionChange={handleSelectionChange}
                placeholder="Hey {{MANHATTAN > WORSHIP > Worship Leader}}, don't forget to submit your set list!"
                placeholderTextColor="#999"
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />

              {/* Autocomplete Dropdown */}
              {showAutocomplete && (
                <View style={styles.autocomplete}>
                  {loadingPositions ? (
                    <View style={styles.autocompleteLoading}>
                      <ActivityIndicator size="small" color={primaryColor} />
                      <Text style={styles.loadingText}>Loading positions...</Text>
                    </View>
                  ) : filteredPositions.length === 0 ? (
                    <Text style={styles.emptyAutocompleteText}>
                      {positions.length === 0
                        ? "No positions available. Configure PCO integration first."
                        : "No positions match your search"}
                    </Text>
                  ) : (
                    <ScrollView
                      style={styles.autocompleteList}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {filteredPositions.map((item) => (
                        <TouchableOpacity
                          key={item.displayName}
                          style={styles.autocompleteItem}
                          onPress={() => insertPosition(item)}
                        >
                          <Ionicons name="person-outline" size={16} color="#666" />
                          <Text style={styles.positionText}>{item.displayName}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Schedule Section */}
          <View style={styles.section}>
            <Text style={styles.label}>Schedule</Text>

            {/* Day of Week */}
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Day</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.dayPicker}>
                  {DAYS_OF_WEEK.map((day) => (
                    <TouchableOpacity
                      key={day.value}
                      style={[
                        styles.dayButton,
                        schedule.dayOfWeek === day.value && {
                          backgroundColor: primaryColor,
                          borderColor: primaryColor,
                        },
                      ]}
                      onPress={() =>
                        setSchedule({ ...schedule, dayOfWeek: day.value })
                      }
                    >
                      <Text
                        style={[
                          styles.dayText,
                          schedule.dayOfWeek === day.value && { color: "#fff" },
                        ]}
                      >
                        {day.short}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Time */}
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleLabel}>Time</Text>
              <TouchableOpacity
                style={styles.timeButton}
                onPress={handleTimePress}
              >
                <Ionicons name="time-outline" size={18} color="#666" />
                <Text style={styles.timeButtonText}>
                  {formatTime24h(schedule.hour, schedule.minute)}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Target Channel */}
          <View style={styles.section}>
            <Text style={styles.label}>Send to Channel</Text>
            <View style={styles.channelPicker}>
              {channelOptions.length > 0 ? (
                channelOptions.map((channel) => (
                  <TouchableOpacity
                    key={channel.slug}
                    style={[
                      styles.channelButton,
                      targetChannelSlug === channel.slug && {
                        backgroundColor: primaryColor,
                        borderColor: primaryColor,
                      },
                    ]}
                    onPress={() => setTargetChannelSlug(channel.slug)}
                  >
                    <Text
                      style={[
                        styles.channelText,
                        targetChannelSlug === channel.slug && { color: "#fff" },
                      ]}
                    >
                      {channel.name}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <>
                  {["leaders", "general"].map((channel) => (
                    <TouchableOpacity
                      key={channel}
                      style={[
                        styles.channelButton,
                        targetChannelSlug === channel && {
                          backgroundColor: primaryColor,
                          borderColor: primaryColor,
                        },
                      ]}
                      onPress={() => setTargetChannelSlug(channel)}
                    >
                      <Text
                        style={[
                          styles.channelText,
                          targetChannelSlug === channel && { color: "#fff" },
                        ]}
                      >
                        {channel === "leaders" ? "Leaders" : "General"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
          </View>
        </ScrollView>

        {/* iOS Time Picker Modal */}
        {Platform.OS === "ios" && showTimePicker && (
          <Modal
            visible={showTimePicker}
            transparent
            animationType="slide"
            onRequestClose={handleTimeCancel}
          >
            <View style={styles.timePickerOverlay}>
              <View style={styles.timePickerContainer}>
                <View style={styles.timePickerHeader}>
                  <TouchableOpacity onPress={handleTimeCancel}>
                    <Text style={styles.timePickerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.timePickerTitle}>Select Time</Text>
                  <TouchableOpacity onPress={handleTimeConfirm}>
                    <Text style={[styles.timePickerDone, { color: primaryColor }]}>
                      Done
                    </Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={tempTimeDate || getTimeAsDate()}
                  mode="time"
                  display="spinner"
                  onChange={handleTimeChange}
                  style={styles.iosTimePicker}
                  textColor="#000000"
                />
              </View>
            </View>
          </Modal>
        )}

        {/* Android Time Picker */}
        {Platform.OS === "android" && showTimePicker && (
          <DateTimePicker
            value={getTimeAsDate()}
            mode="time"
            display="default"
            onChange={handleTimeChange}
            is24Hour={true}
          />
        )}
      </KeyboardAvoidingView>
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
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  closeButton: {
    padding: 4,
    width: 50,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  saveButton: {
    width: 50,
    alignItems: "flex-end",
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  saveButtonTextDisabled: {
    opacity: 0.4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  infoText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    lineHeight: 20,
  },
  messagesList: {
    marginBottom: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  messageCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: "row",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageCardDisabled: {
    opacity: 0.6,
  },
  messageContent: {
    flex: 1,
    padding: 14,
  },
  messageText: {
    fontSize: 15,
    color: "#333",
    lineHeight: 20,
    marginBottom: 8,
  },
  messageTextDisabled: {
    color: "#999",
  },
  messageInfo: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  messageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  messageBadgeText: {
    fontSize: 12,
    color: "#666",
  },
  messageActions: {
    borderLeftWidth: 1,
    borderLeftColor: "#f0f0f0",
    padding: 8,
    justifyContent: "space-around",
  },
  toggleButton: {
    padding: 8,
  },
  sendNowButton: {
    padding: 8,
  },
  deleteButton: {
    padding: 8,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 16,
    backgroundColor: "#fff",
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 8,
  },
  textInputContainer: {
    position: "relative",
  },
  textArea: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
    minHeight: 120,
  },
  autocomplete: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    maxHeight: 200,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    marginTop: 4,
    zIndex: 1000,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  autocompleteList: {
    maxHeight: 192,
  },
  autocompleteItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  autocompleteLoading: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
  },
  positionText: {
    fontSize: 14,
    color: "#333",
    flex: 1,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  emptyAutocompleteText: {
    padding: 12,
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  scheduleRow: {
    marginTop: 12,
  },
  scheduleLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  dayPicker: {
    flexDirection: "row",
    gap: 8,
  },
  dayButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fff",
  },
  dayText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  timeButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  timePickerContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  timePickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  timePickerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
  },
  timePickerCancel: {
    fontSize: 17,
    color: "#666",
  },
  timePickerDone: {
    fontSize: 17,
    fontWeight: "600",
  },
  iosTimePicker: {
    height: 200,
  },
  channelPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  channelButton: {
    flex: 1,
    minWidth: 100,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  channelText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
});
