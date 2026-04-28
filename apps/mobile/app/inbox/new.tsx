/**
 * Start a new direct message
 *
 * Route: /inbox/new
 *
 * Lets the caller search across the people in their communities and start
 * (or open) a 1:1 DM with one of them. On selection we call
 * `createOrGetDirectChannel` and navigate to the resulting channel.
 *
 * Group chats (`group_dm`) are out of scope here — they ship in a later PR.
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
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

type SearchResult = {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
  sharedCommunityNames: string[];
};

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 30;

export default function StartChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pendingUserId, setPendingUserId] = useState<Id<"users"> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Debounce the search query so we don't refetch on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const results = useQuery(
    api.functions.messaging.directMessages.searchUsersInSharedCommunities,
    token
      ? { token, query: debouncedQuery, limit: SEARCH_LIMIT }
      : "skip"
  );

  const createOrGetDirectChannel = useMutation(
    api.functions.messaging.directMessages.createOrGetDirectChannel
  );

  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;
  const isLoadingResults = results === undefined && token != null;

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/chat");
    }
  };

  const handleSelectUser = async (row: SearchResult) => {
    if (!token || pendingUserId) return;
    setErrorMessage(null);
    setPendingUserId(row.userId);
    try {
      const { channelId } = await createOrGetDirectChannel({
        token,
        recipientUserId: row.userId,
      });
      // Pass recipient name + photo as URL params so the chat header has
      // something to show before the channel doc loads — `ConvexChatRoomScreen`
      // reads `groupName` / `imageUrl` directly off `useLocalSearchParams`.
      router.replace({
        pathname: `/inbox/dm/${channelId}` as any,
        params: {
          groupName: row.displayName,
          imageUrl: row.profilePhoto ?? "",
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      setErrorMessage(message);
      setPendingUserId(null);
    }
  };

  const renderItem = ({ item }: { item: SearchResult }) => {
    const isPending = pendingUserId === item.userId;
    const isAnyPending = pendingUserId !== null;
    const subtitle = item.sharedCommunityNames.slice(0, 2).join(" • ");
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { borderBottomColor: colors.border },
          isAnyPending && !isPending && styles.rowDimmed,
        ]}
        onPress={() => handleSelectUser(item)}
        disabled={isAnyPending}
        activeOpacity={0.7}
      >
        <Avatar
          name={item.displayName}
          imageUrl={item.profilePhoto}
          size={48}
        />
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
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
        {isPending ? (
          <ActivityIndicator size="small" color={primaryColor} />
        ) : null}
      </TouchableOpacity>
    );
  };

  const emptyState = useMemo(() => {
    if (isLoadingResults) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      );
    }
    if (!hasQuery && (results?.length ?? 0) === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Type to find someone in your communities.
          </Text>
        </View>
      );
    }
    if (hasQuery && (results?.length ?? 0) === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No matches in your communities.
          </Text>
        </View>
      );
    }
    return null;
  }, [hasQuery, isLoadingResults, results, colors.textSecondary, primaryColor]);

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
            paddingTop: insets.top + 16,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleClose}
          style={styles.headerSide}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New chat</Text>
        <View style={styles.headerSide} />
      </View>

      {/* Search input */}
      <View style={styles.searchContainer}>
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
        {errorMessage ? (
          <Text style={[styles.errorText, { color: colors.error }]}>
            {errorMessage}
          </Text>
        ) : null}
      </View>

      {/* Results */}
      <FlatList
        data={results ?? []}
        keyExtractor={(item) => item.userId}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={emptyState}
        contentContainerStyle={
          (results?.length ?? 0) === 0 ? styles.emptyListContent : undefined
        }
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerSide: {
    width: 40,
    height: 32,
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "500",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    fontWeight: "500",
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  emptyListContent: {
    flexGrow: 1,
  },
});
