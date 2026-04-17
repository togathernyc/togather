/**
 * PosterAccessModal — superuser-only panel to grant/revoke poster_admin.
 *
 * Renders the current poster_admin list + a user search to grant new access.
 * Only rendered when the caller is isSuperuser/isStaff; server also enforces.
 */
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { Avatar } from "@components/ui/Avatar";

interface Props {
  visible: boolean;
  onClose: () => void;
}

type UserResult = {
  _id: Id<"users">;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  profilePhoto: string | null;
  alreadyPosterAdmin?: boolean;
  isSuperuser?: boolean;
};

export function PosterAccessModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { token } = useAuth();

  const [query, setQuery] = useState("");

  const admins = useQuery(
    api.functions.posters.listPosterAdmins,
    token && visible ? { token } : "skip",
  ) as UserResult[] | undefined;

  const searchResults = useQuery(
    api.functions.posters.searchUsersForGrant,
    token && visible && query.trim().length >= 2
      ? { token, query, limit: 10 }
      : "skip",
  ) as UserResult[] | undefined;

  const grant = useAuthenticatedMutation(
    api.functions.posters.grantPosterAdmin,
  );
  const revoke = useAuthenticatedMutation(
    api.functions.posters.revokePosterAdmin,
  );

  const [busyUserId, setBusyUserId] = useState<Id<"users"> | null>(null);

  const handleGrant = async (userId: Id<"users">) => {
    setBusyUserId(userId);
    try {
      await grant({ userId });
      setQuery("");
    } catch (err) {
      Alert.alert(
        "Grant failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevoke = async (userId: Id<"users">) => {
    const ok = await confirm("Revoke poster_admin?", "They'll lose access immediately.");
    if (!ok) return;
    setBusyUserId(userId);
    try {
      await revoke({ userId });
    } catch (err) {
      Alert.alert(
        "Revoke failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>
              Poster admin access
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              Current admins
            </Text>
            {admins === undefined ? (
              <ActivityIndicator style={{ marginVertical: 12 }} />
            ) : admins.length === 0 ? (
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                No delegated poster admins yet. Superusers (you) always have access.
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                {admins.map((u) => (
                  <UserRow
                    key={u._id}
                    user={u}
                    busy={busyUserId === u._id}
                    trailing={
                      <TouchableOpacity
                        onPress={() => handleRevoke(u._id)}
                        disabled={busyUserId === u._id}
                        style={styles.revokeBtn}
                      >
                        <Text style={styles.revokeBtnText}>Revoke</Text>
                      </TouchableOpacity>
                    }
                  />
                ))}
              </View>
            )}

            <Text
              style={[
                styles.sectionLabel,
                { color: colors.text, marginTop: 20 },
              ]}
            >
              Grant access
            </Text>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search by name, email, phone…"
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={12}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>

            {query.trim().length >= 2 ? (
              searchResults === undefined ? (
                <ActivityIndicator style={{ marginTop: 12 }} />
              ) : searchResults.length === 0 ? (
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 14,
                    marginTop: 8,
                  }}
                >
                  No matches.
                </Text>
              ) : (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {searchResults.map((u) => (
                    <UserRow
                      key={u._id}
                      user={u}
                      busy={busyUserId === u._id}
                      trailing={
                        u.alreadyPosterAdmin ? (
                          <Text
                            style={{ color: colors.textSecondary, fontSize: 12 }}
                          >
                            Already admin
                          </Text>
                        ) : (
                          <TouchableOpacity
                            onPress={() => handleGrant(u._id)}
                            disabled={busyUserId === u._id}
                            style={[
                              styles.grantBtn,
                              { backgroundColor: colors.text },
                            ]}
                          >
                            <Text
                              style={[
                                styles.grantBtnText,
                                { color: colors.background },
                              ]}
                            >
                              Grant
                            </Text>
                          </TouchableOpacity>
                        )
                      }
                    />
                  ))}
                </View>
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function UserRow({
  user,
  trailing,
  busy,
}: {
  user: UserResult;
  trailing: React.ReactNode;
  busy: boolean;
}) {
  const { colors } = useTheme();
  const displayName = useMemo(() => {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
    return user.email ?? user.phone ?? "Unknown user";
  }, [user]);
  const sub = user.email ?? user.phone ?? "";
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
      ]}
    >
      <Avatar imageUrl={user.profilePhoto ?? undefined} name={displayName} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[styles.rowName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
          {user.isSuperuser ? (
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {"  · superuser"}
            </Text>
          ) : null}
        </Text>
        {sub ? (
          <Text
            style={[styles.rowSub, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator size="small" /> : trailing}
    </View>
  );
}

async function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return window.confirm(`${title}\n\n${message}`);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Revoke", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  content: {
    padding: 16,
    gap: 8,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowName: {
    fontSize: 14,
    fontWeight: "500",
  },
  rowSub: {
    fontSize: 12,
    marginTop: 2,
  },
  grantBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  grantBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  revokeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  revokeBtnText: {
    color: "#e5484d",
    fontSize: 13,
    fontWeight: "600",
  },
});
