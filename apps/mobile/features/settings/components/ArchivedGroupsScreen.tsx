import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { AppImage } from "@components/ui";

type ArchivedGroup = {
  _id: Id<"groups">;
  name: string;
  preview?: string | null;
  groupTypeName?: string | undefined;
  groupTypeSlug?: string | undefined;
  updatedAt?: number | undefined;
  archivedAt?: number | undefined;
};

export function ArchivedGroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const isAdmin = user?.is_admin === true;
  const communityId = community?.id as Id<"communities"> | undefined;

  const queryArgs = useMemo(() => {
    if (!isAdmin || !communityId || !token) return "skip" as const;
    return { token, communityId, limit: 100 };
  }, [isAdmin, communityId, token]);

  const archivedGroups = useQuery(api.functions.groups.index.listArchivedByCommunity, queryArgs) as
    | ArchivedGroup[]
    | undefined;

  const updateGroup = useAuthenticatedMutation(api.functions.groups.index.update);

  const handleUnarchive = useCallback(
    (groupId: Id<"groups">, groupName: string) => {
      Alert.alert(
        "Restore Group",
        `Unarchive "${groupName}"? This will make it visible to members again.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            style: "default",
            onPress: async () => {
              try {
                await updateGroup({ groupId, isArchived: false });
              } catch (e: any) {
                Alert.alert("Error", e?.message || "Failed to restore group. Please try again.");
              }
            },
          },
        ]
      );
    },
    [updateGroup]
  );

  const renderItem = useCallback(
    ({ item }: { item: ArchivedGroup }) => (
      <View style={[styles.row, { backgroundColor: colors.surfaceSecondary }]}>
        <TouchableOpacity
          style={styles.rowLeft}
          onPress={() => router.push(`/groups/${item._id}`)}
          activeOpacity={0.8}
        >
          <AppImage
            source={item.preview ?? null}
            style={styles.avatar}
            placeholder={{
              type: "initials",
              name: item.name,
              backgroundColor: colors.border,
            }}
          />
          <View style={styles.rowText}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
              {item.groupTypeName || "Group"}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.restoreButton, { borderColor: primaryColor, backgroundColor: colors.surface }]}
          onPress={() => handleUnarchive(item._id, item.name)}
        >
          <Text style={[styles.restoreButtonText, { color: primaryColor }]}>Restore</Text>
        </TouchableOpacity>
      </View>
    ),
    [handleUnarchive, primaryColor, router, colors]
  );

  if (!isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20, backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Archived Groups</Text>
        </View>
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Admins only</Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>You don't have access to this page.</Text>
        </View>
      </View>
    );
  }

  const isLoading = archivedGroups === undefined && queryArgs !== "skip";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 20, borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.push("/(user)/settings");
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Archived Groups</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading archived groups...</Text>
        </View>
      ) : (archivedGroups?.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <Ionicons name="archive-outline" size={48} color={colors.iconSecondary} style={{ marginBottom: 12 }} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No archived groups</Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>Archived groups will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={archivedGroups ?? []}
          keyExtractor={(g) => g._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    padding: 12,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  rowText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    marginTop: 2,
    fontSize: 13,
  },
  restoreButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  restoreButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 6,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
});

