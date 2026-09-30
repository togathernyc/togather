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
  eventShortId?: string | null;
  onClose: () => void;
  onSent?: (counts: { invited: number; alreadyInvited: number }) => void;
}

const NOTE_MAX = 140;
// Max recipients per invite. Keep in sync with MAX_INVITE_RECIPIENTS in
// apps/convex/functions/eventInvites.ts, which enforces the same cap server-side.
const MAX_INVITE_RECIPIENTS = 20;
// Debounce for the server-side member search so we don't fire a query per keystroke.
const SEARCH_DEBOUNCE_MS = 250;

export function InviteGroupMembersSheet({
  visible,
  meetingId,
  eventTitle,
  eventScheduledAt,
  eventShortId,
  onClose,
  onSent,
}: InviteGroupMembersSheetProps) {
  const { colors } = useTheme();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Debounce the search term before hitting the server so typing doesn't fire
  // a query per keystroke.
  React.useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [search]);

  // Members are searched and paginated server-side (see
  // listGroupMembersForInvite) so large groups don't blow the read limit.
  const members = useAuthenticatedQuery(
    api.functions.eventInvites.listGroupMembersForInvite,
    visible
      ? {
          meetingId: meetingId as Id<"meetings">,
          search: debouncedSearch || undefined,
        }
      : "skip",
  );

  // Fetch the caller from Convex so the preview shows their actual first
  // name. The auth-context user can be undefined here in cross-community
  // share-link contexts, which previously left the preview saying
  // "Someone invited you to …" while the server-rendered SMS used the
  // real name.
  const currentUser = useAuthenticatedQuery(
    api.functions.users.getCurrentUser,
    visible ? {} : "skip",
  );
  const senderFirstName = currentUser?.firstName?.trim() || "Someone";

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
      setDebouncedSearch("");
      return;
    }
    if (initialized || !members) return;
    const defaultIds = new Set<string>();
    for (const m of members) {
      // Cap the default selection at the server-enforced limit so a routine
      // "open the sheet and send" doesn't hit the recipient cap.
      if (defaultIds.size >= MAX_INVITE_RECIPIENTS) break;
      const reachable = m.hasPhone || m.hasPushTokens;
      // Self is included in the roster (for test sends) but excluded from
      // the default selection so a routine "Invite everyone" tap doesn't
      // text the host themselves.
      if (reachable && !m.alreadyInvited && !m.alreadyRsvped && !m.isSelf) {
        defaultIds.add(m.userId);
      }
    }
    setSelectedIds(defaultIds);
    setInitialized(true);
  }, [visible, members, initialized]);

  // Members already arrive filtered by the server-side `search` argument, so
  // the list is rendered as-is.
  const filtered = members ?? [];

  // "Eligible" = reachable (phone or push), not already invited, not already
  // RSVP'd, and not self. Self stays tappable individually for test sends but
  // is excluded from bulk Select All.
  const eligibleCount = useMemo(
    () =>
      members?.filter(
        (m) =>
          (m.hasPhone || m.hasPushTokens) &&
          !m.alreadyInvited &&
          !m.alreadyRsvped &&
          !m.isSelf,
      ).length ?? 0,
    [members],
  );

  const selectionAtCap = selectedIds.size >= MAX_INVITE_RECIPIENTS;

  const allEligibleSelected = useMemo(() => {
    if (!members) return false;
    // At the cap we can't select any more, so treat the row as "all selected"
    // — a second tap then clears the selection.
    if (selectionAtCap) return true;
    return members
      .filter(
        (m) =>
          (m.hasPhone || m.hasPushTokens) &&
          !m.alreadyInvited &&
          !m.alreadyRsvped &&
          !m.isSelf,
      )
      .every((m) => selectedIds.has(m.userId));
  }, [members, selectedIds, selectionAtCap]);

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
        return next;
      }
      if (next.size >= MAX_INVITE_RECIPIENTS) {
        Alert.alert(
          "Invite limit reached",
          `You can invite up to ${MAX_INVITE_RECIPIENTS} people at a time.`,
        );
        return prev;
      }
      next.add(userId);
      return next;
    });
  };

  const toggleAllEligible = () => {
    if (!members) return;
    setSelectedIds((prev) => {
      if (allEligibleSelected) return new Set();
      const next = new Set(prev);
      let hitLimit = false;
      for (const m of members) {
        if (next.size >= MAX_INVITE_RECIPIENTS) {
          hitLimit = true;
          break;
        }
        const reachable = m.hasPhone || m.hasPushTokens;
        if (reachable && !m.alreadyInvited && !m.alreadyRsvped && !m.isSelf) {
          next.add(m.userId);
        }
      }
      if (hitLimit) {
        Alert.alert(
          "Invite limit reached",
          `You can invite up to ${MAX_INVITE_RECIPIENTS} people at a time. The first ${MAX_INVITE_RECIPIENTS} eligible members are selected.`,
        );
      }
      return next;
    });
  };

  const previewBody = useMemo(() => {
    const lead = `${senderFirstName} invited you to ${eventTitle}`;
    const when = eventScheduledAt
      ? formatScheduledForPreview(eventScheduledAt)
      : null;
    const noteLine = note.trim() ? `\n\n"${note.trim()}"` : "";
    const link = eventShortId
      ? `\n\ntogather.app/e/${eventShortId}`
      : "";
    return `${lead}${when ? `\n${when}` : ""}${noteLine}${link}`;
  }, [senderFirstName, eventTitle, eventScheduledAt, eventShortId, note]);

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
      // Defer the Alert until after the Modal's dismissal animation has run.
      // Firing Alert.alert in the same tick as Modal dismissal causes iOS
      // touch handlers to deadlock — the parent screen looks fine but won't
      // accept scrolls or taps until the app is restarted.
      setTimeout(() => {
        Alert.alert(
          "Invites sent",
          result.alreadyInvited > 0
            ? `${result.invited} invited, ${result.alreadyInvited} were already sent.`
            : `${result.invited} on the way.`,
        );
      }, 350);
    } catch (err) {
      console.error("Invite send error:", err);
      Alert.alert("Error", "Failed to send invites. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // Android hardware-back routes to the outer Modal's onRequestClose. When the
  // confirm overlay is open it should close the overlay only, not the whole
  // sheet (matches what the previous nested Modal did via its own
  // onRequestClose). While a send is in-flight, swallow the back-press so the
  // sheet can't be dismissed mid-mutation.
  const handleRequestClose = () => {
    if (sending) return;
    if (confirming) {
      setConfirming(false);
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleRequestClose}
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

                {(selectedIds.size > 0 || eligibleCount > MAX_INVITE_RECIPIENTS) && (
                  <Text style={[styles.limitHint, { color: colors.textSecondary }]}>
                    {`${selectedIds.size}/${MAX_INVITE_RECIPIENTS} selected · up to ${MAX_INVITE_RECIPIENTS} per invite`}
                  </Text>
                )}

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
                  // A member is unreachable only if they have neither a phone
                  // nor an active push token. RSVP'd members are disabled to
                  // prevent accidental re-invites — Text Blast handles that
                  // path. Self stays tappable so the host can fire a test
                  // invite to themselves.
                  const reachable = m.hasPhone || m.hasPushTokens;
                  const disabled =
                    !reachable || m.alreadyInvited || m.alreadyRsvped;
                  const selected = selectedIds.has(m.userId);
                  const badge = m.isSelf
                    ? "You"
                    : m.alreadyInvited
                      ? "Invited"
                      : !reachable
                        ? "Unreachable"
                        : !m.hasPhone
                          ? "Push only"
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
                                badge === "Going"
                                  ? "#16A34A"
                                  : badge === "You"
                                    ? DEFAULT_PRIMARY_COLOR
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

        {/* Confirm overlay — inline (NOT a nested Modal). React Native's
            iOS dismissal animation gets confused when a Modal-in-a-Modal
            unmounts simultaneously with the parent, leaving the underlying
            screen unresponsive to touches until the app restarts. */}
        {confirming && (
          <View
            style={[styles.confirmOverlay, { backgroundColor: colors.overlay }]}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              activeOpacity={1}
              style={StyleSheet.absoluteFill}
              onPress={() => !sending && setConfirming(false)}
            />
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
        )}
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
  limitHint: { fontSize: 12, marginTop: 2, marginBottom: 4 },

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
    ...StyleSheet.absoluteFillObject,
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
