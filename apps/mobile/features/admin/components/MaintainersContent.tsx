/**
 * MaintainersContent
 *
 * Superuser-only screen for managing dev maintainers — users granted the
 * `dev_maintainer` platform role so they can summon the @Togather dev-assistant
 * (mention it in a thread to open a bug) without being a Togather superuser/staff.
 *
 * Maintainers get the trigger capability ONLY; reviewing, rejecting, and merging
 * bugs stay superuser-only. The route is gated on the backend `myAccess.isSuperAdmin`
 * (server also enforces every mutation); non-superusers see a permission-denied state.
 *
 * Mirrors the poster-admin access UI (PosterAccessModal) but as a full screen,
 * since maintainer management is its own admin destination (/admin/maintainers).
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

type UserResult = {
  _id: Id<"users">;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  profilePhoto: string | null;
  alreadyMaintainer?: boolean;
  isSuperuser?: boolean;
};

export function MaintainersContent() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();

  const access = useQuery(
    api.functions.devAssistant.maintainers.myAccess,
    token ? { token } : "skip",
  );
  const isSuperAdmin = access?.isSuperAdmin === true;

  const [query, setQuery] = useState("");
  const [busyUserId, setBusyUserId] = useState<Id<"users"> | null>(null);

  const maintainers = useQuery(
    api.functions.devAssistant.maintainers.listMaintainers,
    token && isSuperAdmin ? { token } : "skip",
  ) as UserResult[] | undefined;

  const searchResults = useQuery(
    api.functions.devAssistant.maintainers.searchUsersForGrant,
    token && isSuperAdmin && query.trim().length >= 2
      ? { token, query, limit: 10 }
      : "skip",
  ) as UserResult[] | undefined;

  const grant = useAuthenticatedMutation(
    api.functions.devAssistant.maintainers.grantMaintainer,
  );
  const revoke = useAuthenticatedMutation(
    api.functions.devAssistant.maintainers.revokeMaintainer,
  );

  const handleGrant = async (userId: Id<"users">) => {
    setBusyUserId(userId);
    try {
      await grant({ userId });
      setQuery("");
    } catch (err) {
      Alert.alert(
        "Add failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevoke = async (userId: Id<"users">) => {
    const ok = await confirmRevoke();
    if (!ok) return;
    setBusyUserId(userId);
    try {
      await revoke({ userId });
    } catch (err) {
      Alert.alert(
        "Remove failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  // Access gate — non-superusers can't manage maintainers.
  if (access !== undefined && !isSuperAdmin) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Maintainers are managed by Togather staff. You don't have access.
        </Text>
      </View>
    );
  }

  if (access === undefined) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.surface },
        ]}
      >
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surface }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 32 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Maintainers can summon the @Togather dev-assistant in chat to open bugs.
        They can't review, reject, or merge — those stay staff-only.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Current maintainers
      </Text>
      {maintainers === undefined ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : maintainers.length === 0 ? (
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
          No maintainers yet. Staff and superusers always have access.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {maintainers.map((u) => (
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
                  <Text style={styles.revokeBtnText}>Remove</Text>
                </TouchableOpacity>
              }
            />
          ))}
        </View>
      )}

      <Text
        style={[styles.sectionLabel, { color: colors.text, marginTop: 24 }]}
      >
        Add a maintainer
      </Text>
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
          },
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
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.textSecondary}
            />
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
                  u.alreadyMaintainer ? (
                    <Text
                      style={{ color: colors.textSecondary, fontSize: 12 }}
                    >
                      {u.isSuperuser ? "Staff" : "Already added"}
                    </Text>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleGrant(u._id)}
                      disabled={busyUserId === u._id}
                      style={[styles.grantBtn, { backgroundColor: colors.text }]}
                    >
                      <Text
                        style={[
                          styles.grantBtnText,
                          { color: colors.background },
                        ]}
                      >
                        Add
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
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      <Avatar
        imageUrl={user.profilePhoto ?? undefined}
        name={displayName}
        size={36}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[styles.rowName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
          {user.isSuperuser ? (
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {"  · staff"}
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

async function confirmRevoke(): Promise<boolean> {
  const title = "Remove maintainer?";
  const message = "They'll lose dev-assistant access immediately.";
  if (Platform.OS === "web") {
    return window.confirm(`${title}\n\n${message}`);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Remove", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  empty: {
    fontSize: 15,
    textAlign: "center",
  },
  intro: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
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
