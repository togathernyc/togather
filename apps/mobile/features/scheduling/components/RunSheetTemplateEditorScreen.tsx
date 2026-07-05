/**
 * RunSheetTemplateEditorScreen
 *
 * The item editor for one run-sheet TEMPLATE (event templates Phase 2). It
 * reuses the run sheet editor's row/cell building blocks (`RunSheetItemEditors`)
 * plus the shared `GridScrollList`, so the table reads identically to the
 * plan-level `RunSheetScreen` — wired to the `*RunSheetTemplateItem*` mutations.
 *
 * Templates hold durations only, never clock times (a plan concern), so the
 * "Time" column is omitted; everything else — When, Dur, Owner/Role, Notes,
 * Song, duplicate/delete, drag-reorder — matches the plan run sheet.
 *
 * Route: /rostering/[group_id]/templates/runsheet/[template_id]
 * Backend: scheduling.runSheetTemplates.*
 *
 * Auth: leaders / community admins only.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import type { Song } from "@features/songs/types";
import { DEFAULT_ROLE_COLOR } from "../utils/format";
import { InlineText } from "./InlineText";
import { GridScrollList, OptionTag, type GridColumn } from "./GridScrollList";
import { AnchoredMenu, type AnchorRect } from "./AnchoredMenu";
import { CustomModal } from "@components/ui/Modal";
import {
  WhenPill,
  AddButton,
  DurationCell,
  WhoModalBody,
  NotesModalBody,
  SongModalBody,
  SEGMENT_OPTIONS,
  type Segment,
  type RoleOption,
  type ItemPatch,
  type RunSheetItemLike,
} from "./RunSheetItemEditors";
import {
  listRunSheetTemplatesRef,
  renameRunSheetTemplateRef,
  listRunSheetTemplateItemsRef,
  addRunSheetTemplateItemRef,
  updateRunSheetTemplateItemRef,
  deleteRunSheetTemplateItemRef,
  duplicateRunSheetTemplateItemRef,
  reorderRunSheetTemplateItemsRef,
  type RunSheetTemplateItem,
  type RunSheetTemplateSummary,
} from "../api/eventTemplates";

function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const errMsg = (e: unknown) => {
  const err = e as { data?: { message?: string } | string; message?: string };
  const data = err?.data;
  if (typeof data === "string") return data;
  return data?.message ?? err?.message ?? "Please try again.";
};

/** Adapt a template item to the shared editor's `RunSheetItemLike` shape. */
function toItemLike(it: RunSheetTemplateItem): RunSheetItemLike {
  return {
    segment: it.segment,
    description: it.description,
    durationSec: it.durationSec,
    notes: it.notes,
    songDetails: it.songDetails,
    songId: it.songId,
    song: it.song as Song | null,
    assignments: it.assignments,
  };
}

export function RunSheetTemplateEditorScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, community } = useAuth();
  const { group_id, template_id } = useLocalSearchParams<{
    group_id: string;
    template_id: string;
  }>();
  const groupId = group_id as Id<"groups">;
  const templateId = template_id as Id<"runSheetTemplates">;
  const communityId = community?.id ?? "";

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId } : "skip",
  ) as { userRole?: string } | null | undefined;
  const isLeader =
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    user?.is_admin === true;

  const templates = useAuthenticatedQuery(
    listRunSheetTemplatesRef,
    isLeader && groupId ? { groupId } : "skip",
  ) as RunSheetTemplateSummary[] | undefined;
  const template = useMemo(
    () => (templates ?? []).find((t) => t._id === templateId) ?? null,
    [templates, templateId],
  );

  const items = useAuthenticatedQuery(
    listRunSheetTemplateItemsRef,
    isLeader && templateId ? { templateId } : "skip",
  ) as RunSheetTemplateItem[] | undefined;

  const teamsData = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeams,
    isLeader && groupId ? { groupId } : "skip",
  ) as Array<{ _id: Id<"teams">; name: string }> | undefined;

  const addItem = useAuthenticatedMutation(addRunSheetTemplateItemRef);
  const updateItem = useAuthenticatedMutation(updateRunSheetTemplateItemRef);
  const deleteItem = useAuthenticatedMutation(deleteRunSheetTemplateItemRef);
  const duplicateItem = useAuthenticatedMutation(
    duplicateRunSheetTemplateItemRef,
  );
  const reorderItems = useAuthenticatedMutation(reorderRunSheetTemplateItemsRef);
  const renameTemplate = useAuthenticatedMutation(renameRunSheetTemplateRef);

  // Group roles for the "Who" picker — gathered across the group's teams. There
  // is no roster on a template, so `people` is always empty.
  const [rolesByTeam, setRolesByTeam] = useState<
    Record<string, RunSheetRoleInfo[]>
  >({});
  const setRolesForTeam = useCallback(
    (teamId: string, roles: RunSheetRoleInfo[]) => {
      setRolesByTeam((prev) => {
        const existing = prev[teamId];
        if (
          existing &&
          existing.length === roles.length &&
          existing.every(
            (r, i) => r.roleId === roles[i].roleId && r.roleName === roles[i].roleName,
          )
        ) {
          return prev;
        }
        return { ...prev, [teamId]: roles };
      });
    },
    [],
  );
  const roleOptions = useMemo<RoleOption[]>(() => {
    const byId = new Map<string, RoleOption>();
    for (const roles of Object.values(rolesByTeam)) {
      for (const r of roles) {
        byId.set(r.roleId as string, {
          roleId: r.roleId,
          roleName: r.roleName,
          roleColor: r.roleColor,
          people: [],
        });
      }
    }
    return [...byId.values()];
  }, [rolesByTeam]);

  // Roles are fetched per team via RoleLoader; until every team has reported
  // (or there are no teams), treat the (empty) role list as still loading so the
  // Who picker doesn't flash "no roles" before the loaders resolve.
  const rolesLoading =
    teamsData === undefined ||
    (teamsData.length > 0 &&
      Object.keys(rolesByTeam).length < teamsData.length);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [addSegment, setAddSegment] = useState<Segment>("during");
  const [whoItem, setWhoItem] = useState<RunSheetTemplateItem | null>(null);
  const [notesItem, setNotesItem] = useState<RunSheetTemplateItem | null>(null);
  const [songItem, setSongItem] = useState<RunSheetTemplateItem | null>(null);
  const [whenMenu, setWhenMenu] = useState<{
    item: RunSheetTemplateItem;
    anchor: AnchorRect;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);

  const columns: GridColumn[] = useMemo(
    () => [
      { key: "item", label: "Item", width: 220, flex: 3 },
      { key: "when", label: "When", width: 104 },
      { key: "dur", label: "Dur", width: 84, align: "center" },
      { key: "who", label: "Owner / Role", width: 176 },
      { key: "notes", label: "Notes", width: 240, flex: 3 },
      { key: "song", label: "Song", width: 150 },
      { key: "actions", label: "", width: 64, align: "center" },
    ],
    [],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // `listRunSheetTemplateItems` already returns items sorted by (segment,
  // sequence); the flat row order is before → during → after.
  const rows = useMemo(() => {
    const groups: Record<Segment, RunSheetTemplateItem[]> = {
      before: [],
      during: [],
      after: [],
    };
    for (const it of items ?? []) {
      const seg = (it.segment as Segment) ?? "during";
      (groups[seg] ?? groups.during).push(it);
    }
    return groups.before.concat(groups.during, groups.after);
  }, [items]);

  const patchItem = useCallback(
    (itemId: Id<"runSheetTemplateItems">, patch: ItemPatch) =>
      updateItem({ itemId, ...patch }).catch((e) =>
        notifyError("Couldn't save", errMsg(e)),
      ),
    [updateItem],
  );

  const handleAdd = useCallback(
    async (type: string) => {
      try {
        const { itemId } = await addItem({
          templateId,
          type,
          title: type === "header" ? "New section" : "New item",
          segment: addSegment,
        });
        setFocusId(itemId as string);
      } catch (e) {
        notifyError("Couldn't add item", errMsg(e));
      }
    },
    [addItem, templateId, addSegment],
  );

  const handleDuplicate = useCallback(
    (itemId: Id<"runSheetTemplateItems">) =>
      duplicateItem({ itemId }).catch((e) =>
        notifyError("Couldn't duplicate", errMsg(e)),
      ),
    [duplicateItem],
  );

  const handleDelete = useCallback(
    (item: RunSheetTemplateItem) => {
      const doDelete = () =>
        deleteItem({ itemId: item._id }).catch((e) =>
          notifyError("Couldn't delete", errMsg(e)),
        );
      const prompt = `Remove "${item.title}" from the run sheet?`;
      if (Platform.OS === "web") {
        if (typeof window !== "undefined" && window.confirm(prompt)) {
          void doDelete();
        }
        return;
      }
      Alert.alert("Delete item?", prompt, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ]);
    },
    [deleteItem],
  );

  const handleReorder = useCallback(
    (orderedKeys: string[]) => {
      const byId = new Map(rows.map((it) => [it._id as string, it]));
      const orderedItems = orderedKeys
        .map((id) => byId.get(id))
        .filter((it): it is RunSheetTemplateItem => it != null)
        .map((it) => ({
          id: it._id,
          segment: (it.segment as Segment) ?? "during",
        }));
      return reorderItems({ templateId, orderedItems }).catch((e) =>
        notifyError("Couldn't reorder", errMsg(e)),
      );
    },
    [reorderItems, templateId, rows],
  );

  const referencedTeamIds = useMemo(
    () => (teamsData ?? []).map((t) => t._id as string),
    [teamsData],
  );

  const whoLive = whoItem
    ? (items?.find((i) => i._id === whoItem._id) ?? null)
    : null;
  const notesLive = notesItem
    ? (items?.find((i) => i._id === notesItem._id) ?? null)
    : null;
  const songLive = songItem
    ? (items?.find((i) => i._id === songItem._id) ?? null)
    : null;
  const whenLive = whenMenu
    ? (items?.find((i) => i._id === whenMenu.item._id) ?? null)
    : null;

  const templateName = template?.name ?? "Run-sheet template";

  const renderHeaderBar = () => (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Pressable
        onPress={() => template && setRenaming(true)}
        style={styles.headerTitleWrap}
        accessibilityRole="button"
        accessibilityLabel="Rename template"
      >
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {templateName}
        </Text>
        {template ? (
          <Ionicons name="pencil" size={13} color={colors.textTertiary} />
        ) : null}
      </Pressable>
      <View style={styles.headerBtn} />
    </View>
  );

  const loading = isLeader && items === undefined;

  if (groupData === undefined || loading) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        {renderHeaderBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (!isLeader) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        {renderHeaderBar()}
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.gateText, { color: colors.textSecondary }]}>
            Only leaders can edit templates.
          </Text>
        </View>
      </View>
    );
  }

  const listHeader = (
    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
      Build a reusable order of items — songs, headers, and moments with
      durations. Clock times are set on the plan when you apply this template.
    </Text>
  );

  const listFooter = (
    <View>
      <View style={styles.addToRow}>
        <Text style={[styles.addToLabel, { color: colors.textSecondary }]}>
          Add to:
        </Text>
        {SEGMENT_OPTIONS.map((seg) => {
          const active = addSegment === seg.key;
          return (
            <Pressable
              key={seg.key}
              onPress={() => setAddSegment(seg.key)}
              style={styles.addToChipPressable}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.addToChip,
                  {
                    borderColor: active ? primaryColor : colors.border,
                    backgroundColor: active ? primaryColor + "18" : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.addToChipText,
                    { color: active ? primaryColor : colors.textSecondary },
                  ]}
                >
                  {seg.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.addBar}>
        <AddButton
          label="Add item"
          icon="add"
          onPress={() => handleAdd("item")}
          primaryColor={primaryColor}
          colors={colors}
        />
        <AddButton
          label="Song"
          icon="musical-notes"
          onPress={() => handleAdd("song")}
          primaryColor={primaryColor}
          colors={colors}
        />
        <AddButton
          label="Header"
          icon="bookmark"
          onPress={() => handleAdd("header")}
          primaryColor={primaryColor}
          colors={colors}
        />
      </View>
    </View>
  );

  const renderCell = (
    item: RunSheetTemplateItem,
    key: string,
  ): React.ReactNode => {
    const isHeader = item.type === "header";
    const isSong = item.type === "song";
    const song = item.song as Song | null;
    switch (key) {
      case "item":
        return (
          <InlineText
            value={item.title}
            onSave={(t) => {
              void patchItem(item._id, { title: t });
            }}
            placeholder={isHeader ? "Section name" : "Item title"}
            autoFocus={focusId === (item._id as string)}
            maxLength={120}
            required
            accessibilityLabel="Item title"
            style={[
              styles.titleInput,
              isHeader && styles.headerTitleInput,
              { color: colors.text },
            ]}
          />
        );
      case "when": {
        const short =
          SEGMENT_OPTIONS.find((s) => s.key === item.segment)?.short ?? "During";
        return (
          <WhenPill
            label={short}
            colors={colors}
            primaryColor={primaryColor}
            onOpen={(anchor) => setWhenMenu({ item, anchor })}
          />
        );
      }
      case "dur":
        if (isHeader) return null;
        return (
          <DurationCell
            durationSec={item.durationSec}
            onSave={(sec) => void patchItem(item._id, { durationSec: sec })}
            colors={colors}
          />
        );
      case "who":
        return (
          <Pressable
            onPress={() => setWhoItem(item)}
            style={styles.cellPressable}
            accessibilityLabel="Edit owner / role"
          >
            {item.assignments.length > 0 ? (
              <View style={styles.whoChips}>
                {item.assignments.slice(0, 2).map((a) => (
                  <OptionTag
                    key={a.roleId}
                    label={a.roleName}
                    colors={colors}
                    primaryColor={primaryColor}
                    color={a.roleColor ?? DEFAULT_ROLE_COLOR}
                  />
                ))}
                {item.assignments.length > 2 ? (
                  <Text style={[styles.muted, { color: colors.textTertiary }]}>
                    +{item.assignments.length - 2}
                  </Text>
                ) : null}
              </View>
            ) : (
              <OptionTag
                label="＋"
                colors={colors}
                primaryColor={primaryColor}
                placeholder
              />
            )}
          </Pressable>
        );
      case "notes":
        return (
          <Pressable
            onPress={() => setNotesItem(item)}
            style={styles.cellPressable}
            accessibilityLabel="Edit notes"
          >
            <Text
              numberOfLines={2}
              style={[
                styles.cellText,
                {
                  color: item.description ? colors.text : colors.textTertiary,
                },
              ]}
            >
              {item.description && item.description.length > 0
                ? item.description
                : "Add notes"}
              {item.notes.length > 0 ? ` · ${item.notes.length} cues` : ""}
            </Text>
          </Pressable>
        );
      case "song": {
        if (!isSong) {
          return (
            <Text style={[styles.muted, { color: colors.textTertiary }]}>—</Text>
          );
        }
        const resolvedKey = item.songDetails?.key ?? song?.defaultKey;
        return (
          <Pressable
            onPress={() => setSongItem(item)}
            style={styles.cellPressable}
            accessibilityLabel="Edit song"
          >
            {song ? (
              <Text
                numberOfLines={1}
                style={[styles.cellText, { color: colors.text }]}
              >
                {song.title}
                {resolvedKey ? ` · ${resolvedKey}` : ""}
              </Text>
            ) : (
              <Text style={[styles.muted, { color: colors.textTertiary }]}>
                ＋ Song
              </Text>
            )}
          </Pressable>
        );
      }
      case "actions":
        return (
          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => handleDuplicate(item._id)}
              hitSlop={6}
              style={styles.actionBtn}
              accessibilityLabel="Duplicate"
            >
              <Ionicons name="copy-outline" size={16} color={colors.textTertiary} />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item)}
              hitSlop={6}
              style={styles.actionBtn}
              accessibilityLabel="Delete"
            >
              <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            </Pressable>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      {renderHeaderBar()}

      {/* Load every team's roles so the Who picker has group-wide options. */}
      {referencedTeamIds.map((tid) => (
        <RoleLoader
          key={tid}
          teamId={tid as Id<"teams">}
          onLoaded={setRolesForTeam}
        />
      ))}

      {(items ?? []).length === 0 ? (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {listHeader}
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No items yet. Pick a phase under "Add to" below, then add songs,
            headers, and other moments.
          </Text>
          {listFooter}
        </ScrollView>
      ) : (
        <GridScrollList<RunSheetTemplateItem>
          data={rows}
          keyExtractor={(it) => it._id as string}
          onReorder={handleReorder}
          columns={columns}
          renderCell={renderCell}
          storageKey="runSheetTemplate"
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            <View style={{ paddingBottom: insets.bottom + 8 }}>{listFooter}</View>
          }
          contentContainerStyle={styles.gridContent}
        />
      )}

      {/* Who's-involved (roles) editor. */}
      <CustomModal
        visible={whoLive !== null}
        onClose={() => setWhoItem(null)}
        title="Who's involved"
      >
        {whoLive ? (
          <WhoModalBody
            key={whoLive._id}
            item={toItemLike(whoLive)}
            roleOptions={roleOptions}
            onPatch={(patch) => void patchItem(whoLive._id, patch)}
            emptyStateText="No roles are defined for this template yet."
            loading={rolesLoading}
          />
        ) : null}
      </CustomModal>

      {/* Notes editor — timing phase, description, and role-categorized cues. */}
      <CustomModal
        visible={notesLive !== null}
        onClose={() => setNotesItem(null)}
        title="Notes"
      >
        {notesLive ? (
          <NotesModalBody
            key={notesLive._id}
            item={toItemLike(notesLive)}
            onPatch={(patch) => void patchItem(notesLive._id, patch)}
          />
        ) : null}
      </CustomModal>

      {/* Song editor — library link plus per-service key / BPM overrides. */}
      <CustomModal
        visible={songLive !== null}
        onClose={() => setSongItem(null)}
        title="Song"
      >
        {songLive ? (
          <SongModalBody
            key={songLive._id}
            item={toItemLike(songLive)}
            communityId={communityId}
            groupId={group_id ?? ""}
            onPatch={(patch) => void patchItem(songLive._id, patch)}
          />
        ) : null}
      </CustomModal>

      {/* When picker — moves the row between before / during / after phases. */}
      {whenMenu && whenLive ? (
        <AnchoredMenu
          anchor={whenMenu.anchor}
          options={SEGMENT_OPTIONS.map((s) => ({ id: s.key, name: s.label }))}
          selectedId={whenLive.segment}
          onSelect={(id) => {
            if (id) void patchItem(whenLive._id, { segment: id as Segment });
            setWhenMenu(null);
          }}
          onClose={() => setWhenMenu(null)}
        />
      ) : null}

      {/* Rename the template. */}
      <CustomModal
        visible={renaming}
        onClose={() => setRenaming(false)}
        title="Rename template"
      >
        <RenameBody
          key={templateName}
          initialValue={templateName}
          colors={colors}
          primaryColor={primaryColor}
          onSave={(name) => {
            setRenaming(false);
            void renameTemplate({ templateId, name }).catch((e) =>
              notifyError("Couldn't rename", errMsg(e)),
            );
          }}
        />
      </CustomModal>
    </View>
  );
}

type RunSheetRoleInfo = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor?: string;
};

/** Loads a team's roles and reports them up for the group-wide Who picker. */
function RoleLoader({
  teamId,
  onLoaded,
}: {
  teamId: Id<"teams">;
  onLoaded: (teamId: string, roles: RunSheetRoleInfo[]) => void;
}) {
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { teamId },
  ) as Array<{ _id: Id<"teamRoles">; name: string; color?: string }> | undefined;

  React.useEffect(() => {
    if (roles) {
      onLoaded(
        teamId as string,
        roles.map((r) => ({ roleId: r._id, roleName: r.name, roleColor: r.color })),
      );
    }
  }, [roles, teamId, onLoaded]);

  return null;
}

function RenameBody({
  initialValue,
  colors,
  primaryColor,
  onSave,
}: {
  initialValue: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const canSave = value.trim().length > 0;
  return (
    <View style={styles.renameBody}>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Template name"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        maxLength={50}
        returnKeyType="done"
        onSubmitEditing={() => canSave && onSave(value.trim())}
        accessibilityLabel="Template name"
        style={[
          styles.renameInput,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <Pressable
        onPress={() => canSave && onSave(value.trim())}
        disabled={!canSave}
        style={[
          styles.saveBtn,
          { backgroundColor: primaryColor, opacity: canSave ? 1 : 0.5 },
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>Save</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, padding: 4, alignItems: "center" },
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", flexShrink: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  gateText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  scrollContent: { padding: 16 },
  gridContent: { paddingBottom: 8 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  addToRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 24,
  },
  addToLabel: { fontSize: 13, fontWeight: "600" },
  addToChipPressable: { borderRadius: 999 },
  addToChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  addToChipText: { fontSize: 13, fontWeight: "600" },
  titleInput: { fontSize: 15, fontWeight: "600", width: "100%" },
  headerTitleInput: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actionBtn: { padding: 4 },
  addBar: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  cellPressable: { flex: 1, justifyContent: "center" },
  cellText: { fontSize: 13 },
  muted: { fontSize: 13, fontWeight: "500" },
  whoChips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  renameBody: { gap: 12, paddingTop: 4 },
  renameInput: {
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  saveBtn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
