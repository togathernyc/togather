import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";

interface InviteGroupMembersSheetProps {
  visible: boolean;
  meetingId: string;
  eventTitle: string;
  eventScheduledAt?: number;
  eventLocation?: string | null;
  eventShortId?: string | null;
  senderFirstName: string;
  onClose: () => void;
  onSent?: (counts: { invited: number; alreadyInvited: number }) => void;
}

const NOTE_MAX = 140;

export function InviteGroupMembersSheet({
  visible,
  meetingId,
  eventTitle,
  eventScheduledAt,
  eventLocation,
  eventShortId,
  senderFirstName,
  onClose,
  onSent,
}: InviteGroupMembersSheetProps) {
  const { colors } = useTheme();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const members = useAuthenticatedQuery(
    api.functions.eventInvites.listGroupMembersForInvite,
    visible ? { meetingId: meetingId as Id<"meetings"> } : "skip",
  );

  const initiate = useAuthenticatedMutation(
    api.functions.eventInvites.initiate,
  );

  // Seed the selection: all members who have a phone, haven't been invited,
  // and haven't RSVP'd. Runs once per open.
  React.useEffect(() => {
    if (!visible) {
      setInitialized(false);
      setSelectedIds(new Set());
      setNote("");
      setSearch("");
      return;
    }
    if (initialized || !members) return;
    const defaultIds = new Set<string>();
    for (const m of members) {
      if (m.hasPhone && !m.alreadyInvited && !m.alreadyRsvped) {
        defaultIds.add(m.userId);
      }
    }
    setSelectedIds(defaultIds);
    setInitialized(true);
  }, [visible, members, initialized]);

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = `${m.firstName || ""} ${m.lastName || ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [members, search]);

  const eligibleCount = useMemo(
    () =>
      members?.filter((m) => m.hasPhone && !m.alreadyInvited).length ?? 0,
    [members],
  );

  const allEligibleSelected = useMemo(() => {
    if (!members) return false;
    return members
      .filter((m) => m.hasPhone && !m.alreadyInvited)
      .every((m) => selectedIds.has(m.userId));
  }, [members, selectedIds]);

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAllEligible = () => {
    if (!members) return;
    setSelectedIds((prev) => {
      if (allEligibleSelected) return new Set();
      const next = new Set(prev);
      for (const m of members) {
        if (m.hasPhone && !m.alreadyInvited) next.add(m.userId);
      }
      return next;
    });
  };

  const previewBody = useMemo(() => {
    const firstSelectedFirstName =
      (members ?? []).find((m) => selectedIds.has(m.userId))?.firstName ||
      "Friend";
    const lead = `${senderFirstName} invited you to ${eventTitle}`;
    const when = eventScheduledAt
      ? formatScheduledForPreview(eventScheduledAt)
      : null;
    const where = eventLocation || null;
    const whenAndWhere = [when, where].filter(Boolean).join(" · ");
    const noteLine = note.trim() ? `\n\n"${note.trim()}"` : "";
    const link = eventShortId
      ? `\n\ntogather.app/e/${eventShortId}`
      : "";
    // Preview swaps in the first recipient's first name for the leading line
    // so the host sees a concrete example. The server uses the same template
    // per recipient.
    void firstSelectedFirstName; // reserved for {first_name} merge in v2
    return `${lead}${whenAndWhere ? `\n${whenAndWhere}` : ""}${noteLine}${link}`;
  }, [
    members,
    selectedIds,
    senderFirstName,
    eventTitle,
    eventScheduledAt,
    eventLocation,
    eventShortId,
    note,
  ]);

  const handleSendPress = () => {
    if (selectedIds.size === 0) {
      Alert.alert("No one selected", "Pick at least one member to invite.");
      return;
    }
    setConfirming(true);
  };

  const handleConfirm = async () => {
    setSending(true);
    try {
      const result = await initiate({
        meetingId: meetingId as Id<"meetings">,
        recipientUserIds: Array.from(selectedIds) as Id<"users">[],
        personalNote: note.trim() || undefined,
        channels: ["push", "sms"],
      });
      setConfirming(false);
      onSent?.(result);
      onClose();
      Alert.alert(
        "Invites sent",
        result.alreadyInvited > 0
          ? `${result.invited} invited, ${result.alreadyInvited} were already sent.`
          : `${result.invited} on the way.`,
      );
    } catch (err) {
      console.error("Invite send error:", err);
      Alert.alert("Error", "Failed to send invites. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={[styles.overlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={onClose}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={[styles.sheet, { backgroundColor: colors.surface }]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Text style={[styles.headerAction, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text style={[styles.title, { color: colors.text }]}>
                Invite members
              </Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Recipients section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  RECIPIENTS
                </Text>

                <View
                  style={[
                    styles.searchBox,
                    {
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="search" size={16} color={colors.textSecondary} />
                  <TextInput
                    style={[styles.searchInput, { color: colors.text }]}
                    placeholder="Search members"
                    placeholderTextColor={colors.textSecondary}
                    value={search}
                    onChangeText={setSearch}
                  />
                </View>

                <TouchableOpacity
                  style={styles.selectAllRow}
                  onPress={toggleAllEligible}
                  disabled={eligibleCount === 0}
                >
                  <Checkbox
                    checked={allEligibleSelected && eligibleCount > 0}
                    color={DEFAULT_PRIMARY_COLOR}
                  />
                  <Text style={[styles.selectAllText, { color: colors.text }]}>
                    Select all ({eligibleCount} with phone)
                  </Text>
                </TouchableOpacity>

                {members === undefined && (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.textSecondary} />
                  </View>
                )}

                {members && filtered.length === 0 && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {search
                      ? "No members match that search."
                      : "No members to invite."}
                  </Text>
                )}

                {filtered.map((m) => {
                  const disabled = !m.hasPhone || m.alreadyInvited;
                  const selected = selectedIds.has(m.userId);
                  const badge = m.alreadyInvited
                    ? "Invited"
                    : !m.hasPhone
                      ? "No phone"
                      : m.alreadyRsvped
                        ? "Going"
                        : null;
                  return (
                    <TouchableOpacity
                      key={m.userId}
                      style={[styles.memberRow, disabled && styles.memberRowDisabled]}
                      onPress={() => !disabled && toggle(m.userId)}
                      activeOpacity={disabled ? 1 : 0.6}
                    >
                      <Checkbox
                        checked={selected}
                        color={DEFAULT_PRIMARY_COLOR}
                        disabled={disabled}
                      />
                      <Avatar
                        photo={m.profilePhoto}
                        firstName={m.firstName}
                        lastName={m.lastName}
                        surface={colors.surfaceSecondary}
                        textColor={colors.text}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.memberName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() ||
                            "Member"}
                        </Text>
                      </View>
                      {badge && (
                        <Text
                          style={[
                            styles.badge,
                            {
                              color:
                                badge === "No phone"
                                  ? colors.textSecondary
                                  : badge === "Going"
                                    ? "#16A34A"
                                    : colors.textSecondary,
                            },
                          ]}
                        >
                          {badge}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Personal note section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  PERSONAL NOTE (OPTIONAL)
                </Text>
                <TextInput
                  style={[
                    styles.noteInput,
                    {
                      backgroundColor: colors.surfaceSecondary,
                      color: colors.text,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Add a note — event details auto-attached"
                  placeholderTextColor={colors.textSecondary}
                  value={note}
                  onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
                  multiline
                  maxLength={NOTE_MAX}
                  textAlignVertical="top"
                />
                <Text
                  style={[styles.charCount, { color: colors.textSecondary }]}
                >
                  {note.length}/{NOTE_MAX}
                </Text>
              </View>

              {/* Preview section */}
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  PREVIEW
                </Text>
                <View
                  style={[
                    styles.previewBox,
                    {
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.previewText, { color: colors.text }]}>
                    {previewBody}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {/* Sticky CTA */}
            <View
              style={[
                styles.footer,
                { borderTopColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: DEFAULT_PRIMARY_COLOR },
                  selectedIds.size === 0 && styles.sendButtonDisabled,
                ]}
                onPress={handleSendPress}
                disabled={selectedIds.size === 0 || sending}
              >
                <Text style={styles.sendButtonText}>
                  {`Invite ${selectedIds.size} ${selectedIds.size === 1 ? "member" : "members"}`}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Confirm sub-sheet */}
        <Modal
          visible={confirming}
          transparent
          animationType="fade"
          onRequestClose={() => !sending && setConfirming(false)}
        >
          <View style={[styles.confirmOverlay, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.confirmCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.confirmTitle, { color: colors.text }]}>
                Send invites?
              </Text>
              <Text
                style={[styles.confirmBody, { color: colors.textSecondary }]}
              >
                {`${selectedIds.size} ${selectedIds.size === 1 ? "member" : "members"} will get a push and a text from you.`}
              </Text>
              <TouchableOpacity
                style={[
                  styles.confirmPrimary,
                  { backgroundColor: DEFAULT_PRIMARY_COLOR },
                  sending && styles.sendButtonDisabled,
                ]}
                onPress={handleConfirm}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendButtonText}>Send invites</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setConfirming(false)}
                disabled={sending}
              >
                <Text style={[styles.confirmCancelText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Checkbox({
  checked,
  color,
  disabled,
}: {
  checked: boolean;
  color: string;
  disabled?: boolean;
}) {
  return (
    <View
      style={[
        styles.checkbox,
        {
          borderColor: checked ? color : "#9CA3AF",
          backgroundColor: checked ? color : "transparent",
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
    </View>
  );
}

function Avatar({
  photo,
  firstName,
  lastName,
  surface,
  textColor,
}: {
  photo: string | null;
  firstName: string | null;
  lastName: string | null;
  surface: string;
  textColor: string;
}) {
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "·";
  if (photo) {
    return <Image source={{ uri: photo }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, { backgroundColor: surface }]}>
      <Text style={{ color: textColor, fontWeight: "600", fontSize: 13 }}>
        {initials}
      </Text>
    </View>
  );
}

function formatScheduledForPreview(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    flex: 1,
    marginTop: 60,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerAction: { fontSize: 15 },
  title: { fontSize: 16, fontWeight: "600" },

  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 2 },

  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  selectAllText: { fontSize: 14, fontWeight: "500" },

  loadingRow: { paddingVertical: 20, alignItems: "center" },
  emptyText: { fontSize: 14, paddingVertical: 16, textAlign: "center" },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  memberRowDisabled: { opacity: 0.55 },
  memberName: { fontSize: 15 },
  badge: { fontSize: 12, fontWeight: "500" },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 70,
  },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 4 },

  previewBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  previewText: { fontSize: 13, lineHeight: 18 },

  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  sendButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  confirmOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  confirmTitle: { fontSize: 17, fontWeight: "600", marginBottom: 6 },
  confirmBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  confirmPrimary: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmCancel: { paddingVertical: 12, alignItems: "center" },
  confirmCancelText: { fontSize: 14, fontWeight: "500" },
});
