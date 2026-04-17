/**
 * PosterAdminScreen — cross-community curated poster library admin.
 *
 * Route: /(user)/admin/posters
 * Access: requires platformRoles.includes("poster_admin") OR isSuperuser/isStaff.
 * Superusers additionally see the "Manage access" panel to grant poster_admin
 * to other users.
 *
 * Not linked from main nav — operators navigate via direct URL or bookmark.
 */
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Platform,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useQuery,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { AppImage } from "@components/ui/AppImage";
import { PosterEditorModal } from "./PosterEditorModal";
import { PosterAccessModal } from "./PosterAccessModal";

type PosterDoc = {
  _id: Id<"posters">;
  imageUrl: string;
  keywords: string[];
  active: boolean;
  createdAt: number;
};

export function PosterAdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPosterId, setEditingPosterId] = useState<Id<"posters"> | null>(
    null,
  );
  const [accessOpen, setAccessOpen] = useState(false);

  const access = useQuery(
    api.functions.posters.myAccess,
    token ? { token } : "skip",
  );

  // Search when there's a query, otherwise fetch the most recent page.
  const posters = useQuery(
    api.functions.posters.search,
    token ? { token, query: searchQuery, limit: 120 } : "skip",
  ) as PosterDoc[] | undefined;

  const isGated = access === undefined;
  const isDenied = access !== undefined && !access.isPosterAdmin;

  const numColumns = useMemo(() => {
    if (Platform.OS === "web") {
      const w = Dimensions.get("window").width;
      if (w > 1100) return 5;
      if (w > 800) return 4;
      if (w > 500) return 3;
    }
    return 2;
  }, []);

  if (isGated) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isDenied) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="lock-closed" size={40} color={colors.textSecondary} />
        <Text style={[styles.deniedTitle, { color: colors.text }]}>
          Not authorized
        </Text>
        <Text style={[styles.deniedBody, { color: colors.textSecondary }]}>
          You need the poster_admin role to manage the poster library.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Text style={{ color: colors.text }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleOpenNew = () => {
    setEditingPosterId(null);
    setEditorOpen(true);
  };

  const handleOpenEdit = (posterId: Id<"posters">) => {
    setEditingPosterId(posterId);
    setEditorOpen(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Posters
          </Text>
          <View style={styles.headerRight}>
            {access.isSuperAdmin ? (
              <TouchableOpacity
                onPress={() => setAccessOpen(true)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
                hitSlop={8}
              >
                <Ionicons
                  name="people-outline"
                  size={16}
                  color={colors.text}
                />
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                  Access
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handleOpenNew}
              style={[styles.primaryBtn, { backgroundColor: colors.text }]}
              hitSlop={8}
            >
              <Ionicons
                name="add"
                size={18}
                color={colors.background}
              />
              <Text
                style={[styles.primaryBtnText, { color: colors.background }]}
              >
                Upload
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search keywords…"
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={12}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Grid */}
      {posters === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : posters.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>
            {searchQuery ? "No posters match that search." : "No posters yet. Upload one to start."}
          </Text>
        </View>
      ) : (
        <FlatList
          key={numColumns} // force relayout when column count changes
          data={posters}
          numColumns={numColumns}
          keyExtractor={(p) => p._id}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
          renderItem={({ item }) => (
            <PosterCard
              poster={item}
              onPress={() => handleOpenEdit(item._id)}
              columns={numColumns}
            />
          )}
        />
      )}

      <PosterEditorModal
        visible={editorOpen}
        posterId={editingPosterId}
        onClose={() => {
          setEditorOpen(false);
          setEditingPosterId(null);
        }}
      />

      {access.isSuperAdmin ? (
        <PosterAccessModal
          visible={accessOpen}
          onClose={() => setAccessOpen(false)}
        />
      ) : null}
    </View>
  );
}

function PosterCard({
  poster,
  onPress,
  columns,
}: {
  poster: PosterDoc;
  onPress: () => void;
  columns: number;
}) {
  const { colors } = useTheme();
  const keywordPreview = poster.keywords.slice(0, 3).join(" · ");
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, { width: `${100 / columns}%` }]}
    >
      <View
        style={[
          styles.cardInner,
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        ]}
      >
        <View style={styles.cardImageWrap}>
          <AppImage
            source={poster.imageUrl}
            style={styles.cardImage}
            resizeMode="cover"
          />
        </View>
        <View style={styles.cardMeta}>
          <Text
            numberOfLines={1}
            style={[styles.cardKeywords, { color: colors.text }]}
          >
            {keywordPreview || "—"}
          </Text>
          <Text style={[styles.cardCount, { color: colors.textSecondary }]}>
            {poster.keywords.length} keyword{poster.keywords.length === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  deniedTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  deniedBody: {
    fontSize: 14,
    textAlign: "center",
    maxWidth: 320,
  },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  iconBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    gap: 8,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  gridContent: {
    padding: 12,
    paddingBottom: 40,
  },
  gridRow: {
    gap: 12,
  },
  card: {
    paddingHorizontal: 0,
    paddingVertical: 6,
  },
  cardInner: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardImageWrap: {
    aspectRatio: 1,
    width: "100%",
    backgroundColor: "#eee",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardMeta: {
    padding: 10,
    gap: 2,
  },
  cardKeywords: {
    fontSize: 13,
    fontWeight: "500",
  },
  cardCount: {
    fontSize: 11,
  },
});
