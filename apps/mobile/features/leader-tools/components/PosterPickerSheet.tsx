/**
 * PosterPickerSheet — modal for picking an event cover.
 *
 * Users choose from the global curated poster library (keyword search), or
 * fall back to uploading their own image via the always-visible footer button.
 *
 * Parent wires the selection into the meeting's `coverImage` + optional
 * `posterId`. When picked from the library, both are set; when uploaded, only
 * `coverImage` is set and `posterId` is left undefined.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";

const WIDE_BREAKPOINT = 768;
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { AppImage } from "@components/ui/AppImage";
import * as ImagePicker from "expo-image-picker";

type PickedPoster = {
  posterId: Id<"posters">;
  imageUrl: string;
};

type PickedUpload = {
  posterId?: undefined;
  imageUrl: string; // local URI — parent is responsible for R2 upload on submit
};

export type PosterSelection = PickedPoster | PickedUpload;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (selection: PosterSelection) => void;
}

export function PosterPickerSheet({ visible, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const { token } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= WIDE_BREAKPOINT;
  const [query, setQuery] = useState("");

  const posters = useQuery(
    api.functions.posters.search,
    token && visible ? { token, query, limit: 120 } : "skip",
  );

  // Sheet itself is capped at 720px on wide screens (see backdrop below), so
  // column count should scale with that effective width rather than viewport.
  const numColumns = useMemo(() => {
    const effective = isWide ? Math.min(screenWidth, 720) : screenWidth;
    if (effective >= 700) return 4;
    if (effective >= 500) return 3;
    return 2;
  }, [isWide, screenWidth]);

  const handleUploadOwn = async () => {
    // Mirrors the chat attachment pattern (features/chat/components/MessageInput.tsx):
    // ImagePicker.launchImageLibraryAsync handles the web file-input flow
    // internally, so the same call path works on both web and native.
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Please allow photo library access.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    onSelect({ imageUrl: result.assets[0].uri });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.backdrop,
          {
            justifyContent: isWide ? "center" : "flex-end",
            alignItems: isWide ? "center" : "stretch",
            padding: isWide ? 24 : 0,
          },
        ]}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background },
            isWide
              ? {
                  maxWidth: 720,
                  maxHeight: "90%",
                  borderBottomLeftRadius: 18,
                  borderBottomRightRadius: 18,
                }
              : { height: "90%" },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.grabber} />
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.text }]}>
                Choose a poster
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Find an image…"
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={12}>
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {posters === undefined ? (
            <View style={styles.centered}>
              <ActivityIndicator />
            </View>
          ) : posters.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ color: colors.textSecondary }}>
                {query
                  ? "No posters match that search."
                  : "No posters in the library yet."}
              </Text>
            </View>
          ) : (
            <FlatList
              key={numColumns}
              data={posters}
              numColumns={numColumns}
              keyExtractor={(p) => p._id}
              contentContainerStyle={styles.gridContent}
              columnWrapperStyle={
                numColumns > 1 ? styles.gridRow : undefined
              }
              renderItem={({ item }) => (
                <PosterTile
                  imageUrl={item.imageUrl}
                  columns={numColumns}
                  onPress={() => {
                    onSelect({ posterId: item._id, imageUrl: item.imageUrl });
                    onClose();
                  }}
                />
              )}
            />
          )}

          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleUploadOwn}
              style={[styles.uploadBtn, { backgroundColor: colors.text }]}
            >
              <Ionicons
                name="cloud-upload-outline"
                size={18}
                color={colors.background}
              />
              <Text
                style={[styles.uploadBtnText, { color: colors.background }]}
              >
                Upload image
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PosterTile({
  imageUrl,
  onPress,
  columns,
}: {
  imageUrl: string;
  onPress: () => void;
  columns: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.tile, { width: `${100 / columns}%` }]}
    >
      <View style={styles.tileInner}>
        <AppImage
          source={imageUrl}
          style={styles.tileImage}
          resizeMode="cover"
        />
      </View>
    </TouchableOpacity>
  );
}


const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    width: "100%",
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(120,120,120,0.3)",
    alignSelf: "center",
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  centered: {
    flex: 1,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  gridContent: {
    padding: 10,
    paddingBottom: 20,
  },
  gridRow: {
    gap: 10,
  },
  tile: {
    paddingVertical: 5,
  },
  tileInner: {
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#eee",
  },
  tileImage: {
    width: "100%",
    height: "100%",
  },
  footer: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  uploadBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
