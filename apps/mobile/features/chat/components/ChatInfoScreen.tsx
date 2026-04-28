/**
 * Chat Info Screen
 *
 * Settings + member management surface for an ad-hoc DM/group_dm. Reached
 * by tapping the chat-room header. Shows:
 *
 *   - Stacked-avatar hero with the chat name (rename inline if group_dm)
 *   - Member rows with role + tap-to-act menu (View profile, Remove)
 *   - "Add people" entry that opens an in-screen picker reusing
 *     `searchUsersInSharedCommunities`
 *   - "Leave chat" destructive action
 *
 * The screen sources its member list from `getDirectInbox`'s row for this
 * channel — that endpoint already returns the member set the client is
 * authorised to see (excludes blocked / left rows). We pair it with
 * `getChannel` for canonical metadata (channelType, name, isAdHoc).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  FlatList,
  Alert,
  ActionSheetIOS,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@components/ui/Avatar";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { CustomModal } from "@components/ui/Modal";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useQuery,
  api,
  useStoredAuthToken,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { StackedMemberAvatars } from "./StackedMemberAvatars";
import { useAdHocChannelManagement } from "../hooks/useAdHocChannelManagement";

type Props = {
  channelId: Id<"chatChannels">;
};

type SearchResult = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
  sharedCommunityNames: string[];
};

type Member = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
  isSelf: boolean;
  isInviter: boolean;
};

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 30;
const MAX_TOTAL_MEMBERS = 20;

export function ChatInfoScreen({ channelId }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, community } = useAuth();
  const token = useStoredAuthToken();
  const { colors } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const communityId = community?.id as Id<"communities"> | undefined;

  const channel = useQuery(
    api.functions.messaging.channels.getChannel,
    token ? { token, channelId } : "skip",
  );
  // The inbox query is the simplest source of `otherMembers` for the
  // current user's ad-hoc channels; it filters by request state already.
  const directInbox = useQuery(
    api.functions.messaging.directMessages.getDirectInbox,
    token && communityId ? { token, communityId } : "skip",
  );

  const { rename, addMembers, removeMember, leave } =
    useAdHocChannelManagement(channelId);

  const inboxRow = useMemo(() => {
    if (!directInbox) return null;
    return directInbox.find((row) => row.channelId === channelId) ?? null;
  }, [directInbox, channelId]);

  const isGroupDm = channel?.channelType === "group_dm";
  const isAdHoc = channel?.isAdHoc === true;
  // The creator is the closest proxy we have for "inviter" without a
  // per-member field on this query path. Highlights the row in the UI;
  // remove permissions follow the same rule (creator-only — backend
  // enforces; see Agent A's `removeAdHocMember`).
  const creatorId = (channel as { createdById?: Id<"users"> } | null)
    ?.createdById;
  const currentUserId = user?.id as Id<"users"> | undefined;
  const isCreator = !!currentUserId && currentUserId === creatorId;

  const selfDisplayName = useMemo(() => {
    const first = user?.first_name ?? "";
    const last = user?.last_name ?? "";
    const joined = `${first} ${last}`.trim();
    return joined.length > 0 ? joined : "You";
  }, [user]);

  const members: Member[] = useMemo(() => {
    if (!inboxRow || !currentUserId) return [];
    const others: Member[] = inboxRow.otherMembers.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      profilePhoto: m.profilePhoto,
      isSelf: false,
      isInviter: m.userId === creatorId,
    }));
    const self: Member = {
      userId: currentUserId,
      displayName: selfDisplayName,
      profilePhoto: (user as { profile_photo?: string | null } | null)?.profile_photo ?? null,
      isSelf: true,
      isInviter: currentUserId === creatorId,
    };
    return [self, ...others];
  }, [inboxRow, currentUserId, creatorId, selfDisplayName, user]);

  const otherAvatars = useMemo(
    () =>
      (inboxRow?.otherMembers ?? []).map((m) => ({
        name: m.displayName,
        imageUrl: m.profilePhoto,
      })),
    [inboxRow],
  );

  const channelName = useMemo(() => {
    if (!channel) return "";
    if (channel.channelType === "dm") {
      return inboxRow?.otherMembers[0]?.displayName ?? "Conversation";
    }
    if (channel.name && channel.name.trim().length > 0) return channel.name;
    return (
      (inboxRow?.otherMembers ?? [])
        .slice(0, 3)
        .map((m) => m.displayName.split(" ")[0])
        .filter(Boolean)
        .join(", ") || "Chat"
    );
  }, [channel, inboxRow]);

  // ---- UI state ----
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [addPeopleVisible, setAddPeopleVisible] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (renameVisible && channel?.name) {
      setRenameValue(channel.name);
    }
  }, [renameVisible, channel?.name]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/dm/${channelId}` as any);
    }
  }, [router, channelId]);

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setErrorMessage("Chat name can't be empty");
      return;
    }
    setRenameSubmitting(true);
    try {
      await rename(trimmed);
      setRenameVisible(false);
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not rename chat");
    } finally {
      setRenameSubmitting(false);
    }
  }, [renameValue, rename]);

  const handleConfirmRemove = useCallback(async () => {
    if (!pendingRemove) return;
    setActionInFlight(true);
    try {
      await removeMember(pendingRemove.userId);
      setPendingRemove(null);
    } catch (e) {
      Alert.alert(
        "Couldn't remove",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setActionInFlight(false);
    }
  }, [pendingRemove, removeMember]);

  const handleConfirmLeave = useCallback(async () => {
    setActionInFlight(true);
    try {
      await leave();
      setLeaveVisible(false);
      // Pop back twice in spirit: out of /info AND out of /[channelId].
      // `replace` to inbox keeps the stack clean.
      router.replace("/(tabs)/chat");
    } catch (e) {
      Alert.alert(
        "Couldn't leave",
        e instanceof Error ? e.message : "Please try again.",
      );
    } finally {
      setActionInFlight(false);
    }
  }, [leave, router]);

  const openMemberMenu = useCallback(
    (member: Member) => {
      if (member.isSelf) return;
      // Backend enforces "only creator can remove" — UI mirrors that gate
      // so non-creators see only the read-only profile entry.
      const canRemove = isCreator && !member.isSelf;
      const options = canRemove
        ? ["Cancel", "View profile", "Remove from chat"]
        : ["Cancel", "View profile"];
      const destructiveButtonIndex = canRemove ? 2 : undefined;

      const handleSelection = (index: number) => {
        if (index === 1) {
          router.push(`/profile/${member.userId}` as any);
          return;
        }
        if (canRemove && index === 2) {
          setPendingRemove(member);
        }
      };

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            cancelButtonIndex: 0,
            destructiveButtonIndex,
          },
          handleSelection,
        );
      } else {
        // Lightweight Android/web fallback. iMessage parity isn't critical
        // here — non-iOS users get an Alert with the same options.
        Alert.alert(member.displayName, undefined, [
          { text: "Cancel", style: "cancel" },
          {
            text: "View profile",
            onPress: () => handleSelection(1),
          },
          ...(canRemove
            ? [
                {
                  text: "Remove from chat",
                  style: "destructive" as const,
                  onPress: () => handleSelection(2),
                },
              ]
            : []),
        ]);
      }
    },
    [isCreator, router],
  );

  // -- Rendering --
  if (channel === undefined || directInbox === undefined) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  if (!channel || !isAdHoc) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This conversation is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  const memberCount = members.length;
  const remainingSlots = Math.max(0, MAX_TOTAL_MEMBERS - memberCount);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <Header onBack={handleBack} colors={colors} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <View style={styles.heroSection}>
          <StackedMemberAvatars
            members={otherAvatars.length > 0 ? otherAvatars : [{ name: channelName, imageUrl: null }]}
            size={96}
            surfaceColor={colors.surface}
          />
          <Pressable
            onPress={() => {
              if (isGroupDm) setRenameVisible(true);
            }}
            disabled={!isGroupDm}
            style={({ pressed }) => [
              styles.heroNameRow,
              pressed && isGroupDm && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[styles.heroName, { color: colors.text }]}
              numberOfLines={2}
            >
              {channelName}
            </Text>
            {isGroupDm ? (
              <Ionicons
                name="pencil"
                size={16}
                color={colors.textSecondary}
                style={styles.heroEditIcon}
              />
            ) : null}
          </Pressable>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            {memberCount} {memberCount === 1 ? "person" : "people"}
          </Text>
        </View>

        {/* Members */}
        <SectionHeader colors={colors} label="Members" />
        <View
          style={[
            styles.sectionGroup,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          {members.map((m, idx) => (
            <Pressable
              key={m.userId}
              onPress={() => openMemberMenu(m)}
              disabled={m.isSelf}
              style={({ pressed }) => [
                styles.memberRow,
                idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                pressed && !m.isSelf && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Avatar
                name={m.displayName}
                imageUrl={m.profilePhoto}
                size={40}
              />
              <View style={styles.memberRowText}>
                <Text
                  style={[styles.memberRowName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {m.displayName}
                  {m.isSelf ? (
                    <Text style={{ color: colors.textSecondary }}> (you)</Text>
                  ) : null}
                </Text>
                {m.isInviter ? (
                  <Text
                    style={[
                      styles.memberRowSubtitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Started this chat
                  </Text>
                ) : null}
              </View>
              {!m.isSelf ? (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              ) : null}
            </Pressable>
          ))}
        </View>

        {/* Add people */}
        {remainingSlots > 0 ? (
          <Pressable
            onPress={() => setAddPeopleVisible(true)}
            style={({ pressed }) => [
              styles.actionRow,
              { backgroundColor: pressed ? colors.selectedBackground : colors.surfaceSecondary },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: accentLight }]}>
              <Ionicons name="person-add" size={18} color={primaryColor} />
            </View>
            <Text style={[styles.actionLabel, { color: colors.text }]}>
              Add people
            </Text>
          </Pressable>
        ) : null}

        {/* Channel actions */}
        <SectionHeader colors={colors} label="Chat actions" />
        <View
          style={[
            styles.sectionGroup,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          {isGroupDm ? (
            <Pressable
              onPress={() => setRenameVisible(true)}
              style={({ pressed }) => [
                styles.actionRowFlat,
                pressed && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Ionicons name="create-outline" size={20} color={colors.icon} />
              <Text style={[styles.actionLabel, { color: colors.text }]}>
                Rename chat
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setLeaveVisible(true)}
            style={({ pressed }) => [
              styles.actionRowFlat,
              isGroupDm && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
              pressed && { backgroundColor: colors.selectedBackground },
            ]}
          >
            <Ionicons
              name="exit-outline"
              size={20}
              color={colors.destructive}
            />
            <Text style={[styles.actionLabel, { color: colors.destructive }]}>
              Leave chat
            </Text>
          </Pressable>
        </View>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>

      {/* Rename modal */}
      <CustomModal
        visible={renameVisible}
        onClose={() => {
          if (!renameSubmitting) {
            setRenameVisible(false);
            setErrorMessage(null);
          }
        }}
        title="Rename chat"
      >
        <View>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Chat name"
            placeholderTextColor={colors.textSecondary}
            maxLength={100}
            autoFocus
            style={[
              styles.renameInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
              },
            ]}
          />
          {errorMessage ? (
            <Text style={[styles.errorText, { color: colors.destructive, marginTop: 8 }]}>
              {errorMessage}
            </Text>
          ) : null}
          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              onPress={() => {
                setRenameVisible(false);
                setErrorMessage(null);
              }}
              disabled={renameSubmitting}
              style={[
                styles.modalButton,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Text style={[styles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRenameSubmit}
              disabled={renameSubmitting}
              style={[
                styles.modalButton,
                { backgroundColor: primaryColor },
                renameSubmitting && { opacity: 0.6 },
              ]}
            >
              {renameSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={[styles.modalButtonText, { color: "#ffffff" }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </CustomModal>

      {/* Add people modal */}
      <AddPeopleModal
        visible={addPeopleVisible}
        onClose={() => setAddPeopleVisible(false)}
        onSubmit={async (userIds) => {
          await addMembers(userIds);
        }}
        excludeUserIds={members.map((m) => m.userId)}
        remainingSlots={remainingSlots}
      />

      {/* Remove confirm */}
      <ConfirmModal
        visible={!!pendingRemove}
        title="Remove from chat"
        message={
          pendingRemove
            ? `Remove ${pendingRemove.displayName} from this chat? They won't see new messages.`
            : ""
        }
        onConfirm={handleConfirmRemove}
        onCancel={() => setPendingRemove(null)}
        confirmText="Remove"
        destructive
        isLoading={actionInFlight}
      />

      {/* Leave confirm */}
      <ConfirmModal
        visible={leaveVisible}
        title="Leave chat"
        message="You won't see new messages and the chat will be removed from your inbox."
        onConfirm={handleConfirmLeave}
        onCancel={() => setLeaveVisible(false)}
        confirmText="Leave"
        destructive
        isLoading={actionInFlight}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------

function Header({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.headerBar,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <TouchableOpacity onPress={onBack} style={styles.headerBackButton} hitSlop={12}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Chat info</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function SectionHeader({
  colors,
  label,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  label: string;
}) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
      {label.toUpperCase()}
    </Text>
  );
}

// ---------------------------------------------------------------------------

type AddPeopleModalProps = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (userIds: Id<"users">[]) => Promise<void>;
  excludeUserIds: Id<"users">[];
  remainingSlots: number;
};

function AddPeopleModal({
  visible,
  onClose,
  onSubmit,
  excludeUserIds,
  remainingSlots,
}: AddPeopleModalProps) {
  const { colors } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const { token, community } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<Map<Id<"users">, SearchResult>>(
    new Map(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setDebouncedQuery("");
      setSelected(new Map());
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const trimmed = debouncedQuery.trim();
  const hasQuery = trimmed.length > 0;

  const results = useQuery(
    api.functions.messaging.directMessages.searchUsersInSharedCommunities,
    visible && token && communityId && hasQuery
      ? {
          token,
          communityId,
          query: debouncedQuery,
          excludeUserIds,
          limit: SEARCH_LIMIT,
        }
      : "skip",
  );

  const isLoading = visible && hasQuery && results === undefined && !!token;

  const toggle = (item: SearchResult) => {
    if (submitting) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.userId)) {
        next.delete(item.userId);
      } else {
        if (next.size >= remainingSlots) {
          setError(`You can add up to ${remainingSlots} more here.`);
          return prev;
        }
        next.set(item.userId, item);
      }
      setError(null);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(Array.from(selected.keys()));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add people.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: SearchResult }) => {
    const isSelected = selected.has(item.userId);
    return (
      <TouchableOpacity
        onPress={() => toggle(item)}
        disabled={submitting}
        style={[styles.searchRow, { borderBottomColor: colors.border }]}
        activeOpacity={0.7}
      >
        <Avatar
          name={item.displayName}
          imageUrl={item.profilePhoto}
          size={40}
        />
        <View style={styles.searchRowText}>
          <Text style={[styles.searchRowName, { color: colors.text }]} numberOfLines={1}>
            {item.displayName}
          </Text>
        </View>
        <View
          style={[
            styles.checkmark,
            {
              borderColor: isSelected ? primaryColor : colors.border,
              backgroundColor: isSelected ? primaryColor : "transparent",
            },
          ]}
        >
          {isSelected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <CustomModal
      visible={visible}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="Add people"
      contentPadding="16px"
    >
      <View style={{ minHeight: 360 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name…"
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
          style={[
            styles.renameInput,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        />
        {selected.size > 0 ? (
          <View style={[styles.chipRow, { backgroundColor: accentLight }]}>
            <Text style={[styles.chipRowText, { color: primaryColor }]}>
              {selected.size} selected
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={[styles.errorText, { color: colors.destructive, marginTop: 8 }]}>
            {error}
          </Text>
        ) : null}
        <View style={{ height: 12 }} />
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        ) : !hasQuery ? (
          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            Search for someone in your community to add them.
          </Text>
        ) : (results?.length ?? 0) === 0 ? (
          <Text style={[styles.helper, { color: colors.textSecondary }]}>
            No matches.
          </Text>
        ) : (
          <FlatList
            data={results ?? []}
            keyExtractor={(item) => item.userId}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 320 }}
          />
        )}
        <View style={styles.modalButtonRow}>
          <TouchableOpacity
            onPress={onClose}
            disabled={submitting}
            style={[
              styles.modalButton,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Text style={[styles.modalButtonText, { color: colors.text }]}>
              Cancel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting || selected.size === 0}
            style={[
              styles.modalButton,
              { backgroundColor: primaryColor },
              (submitting || selected.size === 0) && { opacity: 0.5 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={[styles.modalButtonText, { color: "#ffffff" }]}>
                Add
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackButton: {
    padding: 4,
    marginRight: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  heroSection: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  heroNameRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroName: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  heroEditIcon: {
    marginTop: 4,
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  sectionGroup: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 56,
    gap: 12,
  },
  memberRowText: {
    flex: 1,
    minWidth: 0,
  },
  memberRowName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberRowSubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  actionRowFlat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchRowText: {
    flex: 1,
    minWidth: 0,
  },
  searchRowName: {
    fontSize: 16,
    fontWeight: "500",
  },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  chipRowText: {
    fontSize: 13,
    fontWeight: "600",
  },
  helper: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: "center",
  },
});
