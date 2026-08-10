/**
 * Start a new direct message or group chat
 *
 * Route: /inbox/new
 *
 * Multi-select picker over the caller's shared communities. One recipient
 * selected → 1:1 DM via `createOrGetDirectChannel`. 2+ recipients selected
 * → `group_dm` via `createGroupChat`, with an optional name input. Both
 * flows navigate to `/inbox/dm/{channelId}`.
 *
 * iMessage-style UX: empty by default — start typing to find someone. Selected
 * recipients render as primary-tinted pills above the search field. The bottom
 * CTA reflects the current count.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  LayoutAnimation,
  UIManager,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import {
  WaRow,
  WaSeparator,
  WA_SEPARATOR_INSET,
  WA_SEARCH_PILL_HEIGHT,
  WA_SEARCH_PILL_ICON_SIZE,
  WA_TYPE_SECTION_HEADER,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  RequireProfilePhotoSheet,
  classifyProfilePhotoError,
} from "@features/chat/components/RequireProfilePhotoSheet";

type SearchResult = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
  sharedCommunityNames: string[];
};

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 30;
const MAX_GROUP_RECIPIENTS = 19; // matches MAX_GROUP_DM_RECIPIENTS in directMessages.ts

export default function StartChatScreenRoute() {
  return <StartChatScreen />;
}

// Spring-y feel without bringing in Reanimated. LayoutAnimation handles the
// chip-row height changing when chips are added/removed and the chat-name
// field appearing once we cross the 2-selection threshold.
function configureNextLayoutAnimation() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function StartChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, community, user } = useAuth();
  const { primaryColor, accentLight } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const whatsappShellEnabled = useWhatsappShell();
  const communityId = community?.id as Id<"communities"> | undefined;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // Selected recipients keyed by userId. Map (not Set) so we keep
  // `displayName` + `profilePhoto` for the chip row without re-querying.
  const [selected, setSelected] = useState<Map<Id<"users">, SearchResult>>(
    new Map(),
  );
  const [chatName, setChatName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);

  // Local check; backend re-validates with PROFILE_PHOTO_REQUIRED. Treats an
  // empty/whitespace string as "no photo" so legacy data with empty values
  // doesn't slip through.
  const hasOwnProfilePhoto = (() => {
    const photo = user?.profile_photo;
    return typeof photo === "string" && photo.trim().length > 0;
  })();

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Excluding already-selected ids from the search result keeps the list
  // tidy when someone has a long pick list — they can scroll for more
  // candidates instead of seeing the same names re-appear.
  const excludeUserIds = useMemo(
    () => Array.from(selected.keys()),
    [selected],
  );

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  // iMessage's "To:" field shows nothing until you type. Skipping the query
  // when there's nothing to search for also saves a database read per render.
  const results = useQuery(
    api.functions.messaging.directMessages.searchUsersInSharedCommunities,
    token && communityId && hasQuery
      ? {
          token,
          communityId,
          query: debouncedQuery,
          excludeUserIds,
          limit: SEARCH_LIMIT,
        }
      : "skip",
  );

  // WhatsApp-shell (flag-gated) §6.3: WhatsApp lists your contacts the moment
  // the sheet opens — an empty search-first screen is a structural miss. The
  // search query above deliberately returns [] for an empty term, so browsing
  // has its own endpoint. Flag off keeps the iMessage "nothing until you type"
  // behavior, and this query never fires.
  const directory = useQuery(
    api.functions.messaging.directMessages.listCommunityMembersForNewChat,
    whatsappShellEnabled && token && communityId && !hasQuery
      ? { token, communityId }
      : "skip",
  );

  const createOrGetDirectChannel = useMutation(
    api.functions.messaging.directMessages.createOrGetDirectChannel,
  );
  const createGroupChat = useMutation(
    api.functions.messaging.directMessages.createGroupChat,
  );

  /** Whether the list is showing the at-rest directory rather than search hits. */
  const isBrowsing = whatsappShellEnabled && !hasQuery;
  const listData: SearchResult[] = hasQuery
    ? (results ?? [])
    : isBrowsing
      ? (directory ?? [])
      : [];
  const isLoadingResults =
    token != null &&
    (hasQuery ? results === undefined : isBrowsing && directory === undefined);
  const selectedCount = selected.size;
  const isGroupMode = selectedCount >= 2;

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/chat");
    }
  };

  const toggleSelect = (row: SearchResult) => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.userId)) {
        next.delete(row.userId);
      } else {
        if (next.size >= MAX_GROUP_RECIPIENTS) {
          setErrorMessage(
            `You can include up to ${MAX_GROUP_RECIPIENTS} other people in a chat.`,
          );
          // Soft warning haptic on cap-reached.
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Warning,
          ).catch(() => {});
          return prev;
        }
        next.set(row.userId, row);
      }
      // Selecting/deselecting changes the chip row height and may toggle
      // the chat-name field. Animate the layout change.
      configureNextLayoutAnimation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return next;
    });
  };

  const removeSelected = (userId: Id<"users">) => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.has(userId)) return prev;
      next.delete(userId);
      configureNextLayoutAnimation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!token || !communityId || isSubmitting || selectedCount === 0) return;
    setErrorMessage(null);
    // Local profile-photo gate. The backend re-validates with
    // PROFILE_PHOTO_REQUIRED so the catch below still surfaces the sheet for
    // edge cases (e.g. user object is stale).
    if (!hasOwnProfilePhoto) {
      setPhotoSheetVisible(true);
      return;
    }
    setIsSubmitting(true);
    try {
      if (selectedCount === 1) {
        const only = Array.from(selected.values())[0]!;
        const { channelId } = await createOrGetDirectChannel({
          token,
          communityId,
          recipientUserId: only.userId,
        });
        router.replace({
          pathname: `/inbox/dm/${channelId}` as any,
          params: {
            groupName: only.displayName,
            imageUrl: only.profilePhoto ?? "",
          },
        });
        return;
      }

      const recipientUserIds = Array.from(selected.keys());
      const trimmedName = chatName.trim();
      const { channelId } = await createGroupChat({
        token,
        communityId,
        recipientUserIds,
        ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
      });
      // For group_dm the chat header reads from `groupName`. Fall back to
      // a comma-separated first-names line so unnamed groups are recognizable
      // from the header even before the channel doc loads.
      const headerName =
        trimmedName.length > 0
          ? trimmedName
          : Array.from(selected.values())
              .slice(0, 3)
              .map((u) => u.displayName.split(" ")[0])
              .filter(Boolean)
              .join(", ") || "Group chat";
      router.replace({
        pathname: `/inbox/dm/${channelId}` as any,
        params: {
          groupName: headerName,
          imageUrl: "",
        },
      });
    } catch (e) {
      const photoError = classifyProfilePhotoError(e);
      if (photoError === "self") {
        setPhotoSheetVisible(true);
        setIsSubmitting(false);
        return;
      }
      if (photoError === "recipient") {
        setErrorMessage(
          "One of the people you selected hasn't added a profile photo yet. Ask them to add one first.",
        );
        setIsSubmitting(false);
        return;
      }
      const message = e instanceof Error ? e.message : "Something went wrong";
      setErrorMessage(message);
      setIsSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: SearchResult }) => {
    const isSelected = selected.has(item.userId);
    const subtitle = item.sharedCommunityNames.slice(0, 2).join(" • ");

    // WhatsApp-shell (flag-gated): flat full-bleed WaRow anatomy (§3.1 "New-
    // chat contact list" shares the same row geometry as the Chats list —
    // 56pt circular avatar, hairline separators via WA_SEPARATOR_INSET below)
    // with the existing selection checkmark as the row's rightAccessory
    // instead of a trailing chevron. Flag off renders the original bordered
    // row unchanged.
    if (whatsappShellEnabled) {
      return (
        <WaRow
          avatar={{ imageUrl: item.profilePhoto, label: item.displayName, shape: "circle" }}
          title={item.displayName}
          subtitle={subtitle.length > 0 ? subtitle : undefined}
          accent={primaryColor}
          onPress={() => toggleSelect(item)}
          disabled={isSubmitting}
          style={isSubmitting ? styles.rowDimmed : undefined}
          rightAccessory={
            <View
              style={[
                styles.checkmark,
                {
                  borderColor: isSelected ? primaryColor : colors.separator,
                  backgroundColor: isSelected ? primaryColor : "transparent",
                },
              ]}
            >
              {isSelected ? (
                <Ionicons name="checkmark" size={16} color="#ffffff" />
              ) : null}
            </View>
          }
        />
      );
    }

    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: colors.border },
          isSubmitting && styles.rowDimmed,
        ]}
        onPress={() => toggleSelect(item)}
        disabled={isSubmitting}
        activeOpacity={0.7}
      >
        <Avatar
          name={item.displayName}
          imageUrl={item.profilePhoto}
          size={48}
        />
        <View style={styles.rowText}>
          <Text
            style={[styles.rowName, { color: colors.text }]}
            numberOfLines={1}
          >
            {item.displayName}
          </Text>
          {subtitle.length > 0 ? (
            <Text
              style={[styles.rowSubtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
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
          {isSelected ? (
            <Ionicons name="checkmark" size={16} color="#ffffff" />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const emptyState = useMemo(() => {
    // Mid-flight search: a small spinner near the top so the page doesn't
    // jump between empty and filled states.
    if (isLoadingResults) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      );
    }
    if (!hasQuery) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {isBrowsing
              ? "No one else in your community yet."
              : `Search for someone in your community\nto start a chat.`}
          </Text>
        </View>
      );
    }
    if (hasQuery && (results?.length ?? 0) === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No matches in your community.
          </Text>
          <Text
            style={[styles.emptySubText, { color: colors.textTertiary }]}
          >
            Make sure they&apos;re a member.
          </Text>
        </View>
      );
    }
    return null;
  }, [
    hasQuery,
    isBrowsing,
    isLoadingResults,
    results,
    colors.textSecondary,
    colors.textTertiary,
    primaryColor,
  ]);

  // Always "New chat" — multi-recipient is just a chat with more people.
  const headerTitle = "New chat";
  const ctaLabel =
    selectedCount === 1 ? "Start chat" : "Create chat";

  // Pill chip — primary-tinted background using the community theme's
  // accentLight (10% opacity of primaryColor). On dark themes the body
  // text reads better as `colors.text` than as the primary hue.
  const chipTextColor = isDark ? colors.text : primaryColor;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.surface }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + (whatsappShellEnabled ? 8 : 16),
            paddingBottom: whatsappShellEnabled ? 10 : 12,
            // S1: WA screens carry no bar hairline. Flag off keeps its rule.
            borderBottomWidth: whatsappShellEnabled ? 0 : StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {whatsappShellEnabled ? (
          // §6.1: centered 17pt semibold title with an ×-in-a-light-circle on
          // the RIGHT — the reference has no "Cancel" text button. The left
          // slot is an equal-width spacer so the title stays optically centered.
          <View style={styles.headerSide} />
        ) : (
          <TouchableOpacity
            onPress={handleClose}
            style={styles.headerSide}
            hitSlop={12}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {headerTitle}
        </Text>
        {whatsappShellEnabled ? (
          <View style={styles.headerSide}>
            <TouchableOpacity
              onPress={handleClose}
              style={[
                styles.headerDismissCircle,
                { backgroundColor: colors.backgroundGrouped },
              ]}
              hitSlop={12}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerSide} />
        )}
      </View>

      {/* Selected chips */}
      {selectedCount > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chipsContent}
          keyboardShouldPersistTaps="handled"
        >
          {Array.from(selected.values()).map((row) =>
            whatsappShellEnabled ? (
              // §7 "never colored category chips": the filled pill below
              // becomes a plain avatar token — a small × overlay on the
              // avatar itself, first name below it, no background fill.
              <View key={row.userId} style={styles.waToken}>
                <View style={styles.waTokenAvatarWrap}>
                  <Avatar
                    name={row.displayName}
                    imageUrl={row.profilePhoto}
                    size={48}
                  />
                  <TouchableOpacity
                    onPress={() => removeSelected(row.userId)}
                    accessibilityLabel={`Remove ${row.displayName}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={[styles.waTokenRemove, { backgroundColor: colors.textTertiary }]}
                  >
                    <Ionicons name="close" size={12} color="#ffffff" />
                  </TouchableOpacity>
                </View>
                <Text
                  style={[styles.waTokenName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {row.displayName.split(" ")[0]}
                </Text>
              </View>
            ) : (
              <View
                key={row.userId}
                style={[
                  styles.chip,
                  { backgroundColor: accentLight },
                ]}
              >
                <Avatar
                  name={row.displayName}
                  imageUrl={row.profilePhoto}
                  size={24}
                />
                <Text
                  style={[styles.chipText, { color: chipTextColor }]}
                  numberOfLines={1}
                >
                  {row.displayName.split(" ")[0]}
                </Text>
                <TouchableOpacity
                  onPress={() => removeSelected(row.userId)}
                  accessibilityLabel={`Remove ${row.displayName}`}
                  accessibilityRole="button"
                  hitSlop={12}
                  style={styles.chipRemoveHit}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            )
          )}
        </ScrollView>
      ) : null}

      {/* Optional chat name (only when 2+ selected) */}
      {isGroupMode ? (
        <View style={styles.searchContainer}>
          {whatsappShellEnabled ? (
            <View style={[styles.waPill, { backgroundColor: colors.backgroundGrouped }]}>
              <TextInput
                value={chatName}
                onChangeText={setChatName}
                placeholder="Chat name (optional)"
                placeholderTextColor={colors.textTertiary}
                maxLength={100}
                style={[styles.waPillInput, { color: colors.text }]}
              />
            </View>
          ) : (
            <TextInput
              value={chatName}
              onChangeText={setChatName}
              placeholder="Chat name (optional)"
              placeholderTextColor={colors.textSecondary}
              maxLength={100}
              style={[
                styles.searchInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
              ]}
            />
          )}
        </View>
      ) : null}

      {/* Search input */}
      <View style={styles.searchContainer}>
        {whatsappShellEnabled ? (
          // §4 search pill: fully rounded, `bg.grouped` fill, magnifying-
          // glass icon inset, `text.tertiary` placeholder — no focus border
          // (WhatsApp's own search pill has none).
          <View style={[styles.waPill, { backgroundColor: colors.backgroundGrouped }]}>
            <Ionicons
              name="search"
              size={WA_SEARCH_PILL_ICON_SIZE}
              color={colors.textTertiary}
              style={styles.waPillIcon}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              // §6.2 placeholder style.
              placeholder="Name, number…"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              autoCapitalize="none"
              style={[styles.waPillInput, { color: colors.text }]}
            />
          </View>
        ) : (
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Search by name…"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            style={[
              styles.searchInput,
              {
                color: colors.text,
                backgroundColor: colors.surfaceSecondary,
                borderColor: isFocused ? primaryColor : colors.border,
              },
            ]}
          />
        )}
        {errorMessage ? (
          <Text style={[styles.errorText, { color: colors.error }]}>
            {errorMessage}
          </Text>
        ) : null}
      </View>

      {/* Results */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.userId}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={emptyState}
        // §6.3: the at-rest directory gets a sentence-case gray header, so
        // it reads as a section of the sheet rather than as search results.
        ListHeaderComponent={
          isBrowsing && listData.length > 0 ? (
            <Text style={[styles.directoryHeader, { color: colors.textSecondary }]}>
              Community members
            </Text>
          ) : null
        }
        contentContainerStyle={
          listData.length === 0 ? styles.emptyListContent : undefined
        }
        // §3.1 hairline separators, inset to the text column — WaRow rows
        // carry no border of their own (unlike the flag-off bordered row).
        ItemSeparatorComponent={
          whatsappShellEnabled ? () => <WaSeparator inset={WA_SEPARATOR_INSET} /> : undefined
        }
      />

      {/* CTA */}
      {selectedCount > 0 ? (
        <View
          style={[
            styles.ctaBar,
            // §7 "never cards-with-shadows" — the flag-on bar keeps its
            // hairline top border only, no drop shadow/elevation.
            !whatsappShellEnabled && styles.ctaBarShadow,
            {
              backgroundColor: colors.surface,
              borderTopColor: whatsappShellEnabled ? colors.separator : colors.border,
              paddingBottom: insets.bottom + 12,
              ...(whatsappShellEnabled ? {} : { shadowColor: colors.shadow }),
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={[
              styles.ctaButton,
              { backgroundColor: primaryColor },
              isSubmitting && styles.rowDimmed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.ctaButtonText}>{ctaLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <RequireProfilePhotoSheet
        visible={photoSheetVisible}
        onClose={() => setPhotoSheetVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  // §6.1 dismiss — an × inside a light circle, right-aligned (flag-on only).
  headerDismissCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsRow: {
    flexGrow: 0,
  },
  chipsContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
    maxWidth: 140,
  },
  chipRemoveHit: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  // WhatsApp-shell selected-recipient token (flag-gated) — §7 "never colored
  // category chips": an avatar + small × overlay instead of a filled pill.
  waToken: {
    alignItems: "center",
    width: 56,
  },
  waTokenAvatarWrap: {
    width: 48,
    height: 48,
    position: "relative",
  },
  waTokenRemove: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  waTokenName: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "400",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  // §4 search pill — fully rounded, `bg.grouped` fill, no border. Reused for
  // the optional "Chat name" field too (same input family, icon omitted).
  // S6.5: the search pill is ~44pt tall — the pre-pass 37pt read as too thin.
  waPill: {
    flexDirection: "row",
    alignItems: "center",
    height: WA_SEARCH_PILL_HEIGHT,
    borderRadius: WA_SEARCH_PILL_HEIGHT / 2,
    paddingHorizontal: 14,
  },
  waPillIcon: {
    marginRight: 8,
  },
  waPillInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
  },
  // §6.3/S3.5 — sentence-case gray section header, never ALL-CAPS.
  directoryHeader: {
    fontSize: WA_TYPE_SECTION_HEADER,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowDimmed: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    paddingHorizontal: 24,
    paddingTop: 80,
    alignItems: "center",
    gap: 6,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
    textAlign: "center",
  },
  emptySubText: {
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
  },
  emptyListContent: {
    flexGrow: 1,
  },
  ctaBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Subtle separation from list content. iOS/web pick up the shadow,
  // Android falls back to elevation. Flag-off only — §7 "never
  // cards-with-shadows" drops this on the flag-on path (hairline border only).
  ctaBarShadow: {
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: {
        elevation: 8,
      },
      default: {
        // RN Web honors `boxShadow` as a CSS string.
        boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.06)",
      },
    }),
  },
  ctaButton: {
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
