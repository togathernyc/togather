/**
 * EventEditorScreen
 *
 * The scheduler's per-event screen: edit title / date / time(s), declare
 * needed roles, assign people per role slot, and publish. Each role shows
 * its slots; a filled slot displays the volunteer and their status
 * (✓ Confirmed / … Awaiting / ✗ Declined). A declined slot offers an
 * inline "Refill" affordance. Tapping an open slot opens the assign sheet.
 *
 * Route: /rostering/[group_id]/event/[plan_id]
 *
 * Backend: scheduling.events.getEvent / updateEvent / deleteEvent,
 * scheduling.assignments.unassign / publishEvent, NeededRolesModal +
 * AssignSheet for the sub-flows.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";
import { NeededRolesModal } from "./NeededRolesModal";
import { AssignSheet } from "./AssignSheet";
import { TimesEditor } from "./TimesEditor";
import { TeamChannelToggle } from "./TeamChannelToggle";

/** Formats a Date as a display time label, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

type Assignment = {
  _id: Id<"roleAssignments">;
  userId: Id<"users">;
  userName: string;
  status: string;
  timeLabel?: string;
  declineNote?: string;
};

type EventRole = {
  roleId: Id<"teamRoles">;
  teamId: Id<"teams">;
  roleName: string;
  roleColor?: string;
  needed: number;
  filled: number;
  open: number;
  assignments: Assignment[];
};

type EventDoc = {
  _id: Id<"eventPlans">;
  groupId: Id<"groups">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: string;
  fillSummary: { totalNeeded: number; totalFilled: number };
  roles: EventRole[];
};

export function EventEditorScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { plan_id } = useLocalSearchParams<{ plan_id: string }>();
  const planId = plan_id as Id<"eventPlans">;

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    planId ? { planId } : "skip",
  ) as EventDoc | null | undefined;

  const updateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.updateEvent,
  );
  const deleteEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.deleteEvent,
  );
  const unassign = useAuthenticatedMutation(
    api.functions.scheduling.assignments.unassign,
  );
  const publishEvent = useAuthenticatedAction(
    api.functions.scheduling.assignments.publishEvent,
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [neededVisible, setNeededVisible] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{
    teamId: Id<"teams">;
    roleId: Id<"teamRoles">;
    roleName: string;
  } | null>(null);

  // teamId|roleId -> needed count, fed into the needed-roles modal.
  const currentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const role of event?.roles ?? []) {
      map[`${role.teamId}|${role.roleId}`] = role.needed;
    }
    return map;
  }, [event?.roles]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // Title auto-saves: a debounced save fires as the scheduler types, and any
  // still-pending save is flushed on blur/submit and on leaving the screen.
  // (iOS does not reliably blur a TextInput when you tap elsewhere, so we
  // must not depend on onBlur alone.)
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTitleRef = useRef<string | null>(null);

  const flushTitle = useCallback(async () => {
    if (titleSaveTimer.current) {
      clearTimeout(titleSaveTimer.current);
      titleSaveTimer.current = null;
    }
    const pending = pendingTitleRef.current;
    pendingTitleRef.current = null;
    if (pending == null) return;
    const trimmed = pending.trim();
    if (!trimmed || trimmed === event?.title) return;
    try {
      await updateEvent({ planId, title: trimmed });
    } catch (e: any) {
      Alert.alert("Couldn't rename", e?.message ?? "Please try again.");
    }
  }, [event?.title, updateEvent, planId]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitleDraft(text);
      pendingTitleRef.current = text;
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
      titleSaveTimer.current = setTimeout(() => {
        void flushTitle();
      }, 600);
    },
    [flushTitle],
  );

  const handleSaveTitle = useCallback(() => {
    setEditingTitle(false);
    void flushTitle();
  }, [flushTitle]);

  // Flush a pending title save when the screen unmounts.
  const flushTitleRef = useRef(flushTitle);
  flushTitleRef.current = flushTitle;
  useEffect(() => () => void flushTitleRef.current(), []);

  const handleChangeDate = useCallback(
    async (date: Date | null) => {
      if (!date) return;
      try {
        await updateEvent({ planId, eventDate: date.getTime() });
      } catch (e: any) {
        Alert.alert("Couldn't update date", e?.message ?? "Please try again.");
      }
    },
    [updateEvent, planId],
  );

  // An event plan can have one or more times (e.g. a 9 AM and 11 AM service).
  const saveTimes = useCallback(
    async (times: Array<{ label: string; startsAt: number }>) => {
      try {
        await updateEvent({ planId, times });
      } catch (e: any) {
        Alert.alert("Couldn't update times", e?.message ?? "Please try again.");
      }
    },
    [updateEvent, planId],
  );

  const handleChangeTimeAt = useCallback(
    (index: number, date: Date | null) => {
      if (!date || !event) return;
      void saveTimes(
        event.times.map((t, i) =>
          i === index
            ? { label: formatTimeLabel(date), startsAt: date.getTime() }
            : t,
        ),
      );
    },
    [event, saveTimes],
  );

  const handleRemoveTime = useCallback(
    (index: number) => {
      if (!event) return;
      void saveTimes(event.times.filter((_, i) => i !== index));
    },
    [event, saveTimes],
  );

  const handleAddTime = useCallback(() => {
    if (!event) return;
    const last = event.times[event.times.length - 1];
    let base: Date;
    if (last) {
      base = new Date(last.startsAt + 60 * 60 * 1000); // an hour after the last
    } else {
      base = new Date(event.eventDate);
      base.setHours(9, 0, 0, 0);
    }
    void saveTimes([
      ...event.times,
      { label: formatTimeLabel(base), startsAt: base.getTime() },
    ]);
  }, [event, saveTimes]);

  const handleUnassign = useCallback(
    (assignmentId: Id<"roleAssignments">) => {
      unassign({ assignmentId }).catch((e: any) =>
        Alert.alert("Couldn't remove", e?.message ?? "Please try again."),
      );
    },
    [unassign],
  );

  const handleDelete = useCallback(() => {
    Alert.alert("Delete event plan?", "This removes the event plan and all its assignments.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEvent({ planId });
            if (router.canGoBack()) router.back();
          } catch (e: any) {
            Alert.alert("Couldn't delete", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  }, [deleteEvent, planId, router]);

  const handlePublish = useCallback(() => {
    Alert.alert(
      "Publish & send requests?",
      "Volunteers with an open request will get a push and SMS asking them to accept or decline.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Publish",
          onPress: async () => {
            setPublishing(true);
            try {
              const result = await publishEvent({ planId });
              Alert.alert(
                "Event plan published",
                result.requestCount > 0
                  ? `Sent ${result.requestCount} request${
                      result.requestCount === 1 ? "" : "s"
                    }.`
                  : "No pending requests to send.",
              );
            } catch (e: any) {
              Alert.alert("Couldn't publish", e?.message ?? "Please try again.");
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
    );
  }, [publishEvent, planId]);

  if (event === undefined) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (!event) {
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
            This event plan is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  const isPublished = event.status === "published";
  const singleTimeLabel =
    event.times.length === 1 ? event.times[0].label : undefined;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <Header onBack={handleBack} colors={colors} onDelete={handleDelete} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 96 },
        ]}
      >
        {/* Title */}
        {editingTitle ? (
          <TextInput
            value={titleDraft}
            onChangeText={handleTitleChange}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            returnKeyType="done"
            autoFocus
            maxLength={120}
            placeholder="Event plan title"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.titleInput,
              {
                color: colors.text,
                borderColor: colors.inputBorder,
                backgroundColor: colors.inputBackground,
              },
            ]}
          />
        ) : (
          <Pressable
            onPress={() => {
              setTitleDraft(event.title);
              setEditingTitle(true);
            }}
            style={styles.titleRow}
          >
            <Text style={[styles.title, { color: colors.text }]}>
              {event.title}
            </Text>
            <Ionicons name="pencil" size={16} color={colors.textSecondary} />
          </Pressable>
        )}

        {/* When — date + one or more times, as one cohesive section. */}
        <TimesEditor
          eventDate={event.eventDate}
          times={event.times}
          onChangeDate={handleChangeDate}
          onChangeTimeAt={handleChangeTimeAt}
          onRemoveTime={handleRemoveTime}
          onAddTime={handleAddTime}
        />

        {/* Status pill */}
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: isPublished
                ? colors.success + "22"
                : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              { color: isPublished ? colors.success : colors.textSecondary },
            ]}
          >
            {isPublished ? "Published" : "Draft"}
          </Text>
        </View>

        {/* Auto-save is invisible to users — the only button is "Publish",
            so make clear that edits already persist on their own. */}
        <Text style={[styles.autoSaveHint, { color: colors.textSecondary }]}>
          Changes are saved automatically. Publishing notifies volunteers.
        </Text>

        {/* Needed roles editor entry */}
        <Pressable
          onPress={() => setNeededVisible(true)}
          style={({ pressed }) => [
            styles.actionRow,
            { backgroundColor: colors.surfaceSecondary },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="options-outline" size={20} color={colors.text} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>
            Set needed roles
          </Text>
          <Text style={[styles.actionValue, { color: colors.textSecondary }]}>
            {event.fillSummary.totalFilled}/{event.fillSummary.totalNeeded}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textTertiary}
          />
        </Pressable>

        {/* Per-role assignment view — grouped by team so each team gets a
            header with its chat-channel toggle + "Open chat" shortcut. */}
        {event.roles.length === 0 ? (
          <Text style={[styles.noRolesText, { color: colors.textSecondary }]}>
            No roles needed yet. Tap "Set needed roles" to declare how many of
            each role this event plan needs.
          </Text>
        ) : (
          groupRolesByTeam(event.roles).map((teamGroup) => (
            <TeamRoleGroup
              key={teamGroup.teamId}
              groupId={event.groupId}
              teamId={teamGroup.teamId}
              roles={teamGroup.roles}
              onAssign={(role) =>
                setAssignTarget({
                  teamId: role.teamId,
                  roleId: role.roleId,
                  roleName: role.roleName,
                })
              }
              onUnassign={handleUnassign}
            />
          ))
        )}
      </ScrollView>

      {/* Publish bar */}
      <View
        style={[
          styles.publishBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={handlePublish}
          disabled={publishing}
          style={({ pressed }) => [
            styles.publishBtn,
            { backgroundColor: primaryColor },
            (publishing || pressed) && { opacity: 0.8 },
          ]}
        >
          {publishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.publishBtnText}>
              {isPublished ? "Re-send requests" : "Publish & send requests"}
            </Text>
          )}
        </Pressable>
      </View>

      <NeededRolesModal
        visible={neededVisible}
        planId={planId}
        groupId={event.groupId}
        currentCounts={currentCounts}
        onClose={() => setNeededVisible(false)}
      />

      {assignTarget && (
        <AssignSheet
          visible
          planId={planId}
          groupId={event.groupId}
          teamId={assignTarget.teamId}
          roleId={assignTarget.roleId}
          roleName={assignTarget.roleName}
          timeLabel={singleTimeLabel}
          assignedUserIds={
            new Set(
              event.roles
                .find((r) => r.roleId === assignTarget.roleId)
                ?.assignments.map((a) => a.userId as string) ?? [],
            )
          }
          onClose={() => setAssignTarget(null)}
        />
      )}
    </View>
  );
}

/**
 * Groups the event's flat role list by team, preserving role order within
 * each team. Used to render a team-section header (chat toggle + "Open chat"
 * shortcut) above each team's role cards.
 */
function groupRolesByTeam(roles: EventRole[]): Array<{
  teamId: Id<"teams">;
  roles: EventRole[];
}> {
  const order: Id<"teams">[] = [];
  const byTeam = new Map<Id<"teams">, EventRole[]>();
  for (const role of roles) {
    const existing = byTeam.get(role.teamId);
    if (existing) {
      existing.push(role);
    } else {
      byTeam.set(role.teamId, [role]);
      order.push(role.teamId);
    }
  }
  return order.map((teamId) => ({ teamId, roles: byTeam.get(teamId)! }));
}

/**
 * A team's section: header (name + chat toggle + "Open chat" shortcut) and
 * its role assignment cards. Fetches the team via `getTeam` so it has the
 * `hasChannel` / `channelSlug` / `memberCount` fields the toggle and
 * shortcut both need.
 */
function TeamRoleGroup({
  groupId,
  teamId,
  roles,
  onAssign,
  onUnassign,
}: {
  groupId: Id<"groups">;
  teamId: Id<"teams">;
  roles: EventRole[];
  onAssign: (role: EventRole) => void;
  onUnassign: (id: Id<"roleAssignments">) => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const team = useAuthenticatedQuery(
    api.functions.scheduling.teams.getTeam,
    { teamId },
  ) as
    | {
        _id: Id<"teams">;
        name: string;
        hasChannel: boolean;
        channelSlug: string | null;
        memberCount: number;
      }
    | undefined;

  // Fall back to the role's embedded team-less name while `getTeam` resolves.
  const fallbackName = roles[0]?.roleName ?? "Team";
  const teamName = team?.name ?? fallbackName;

  return (
    <View style={styles.teamGroup}>
      <View style={styles.teamGroupHeader}>
        <Text
          style={[styles.teamGroupName, { color: colors.text }]}
          numberOfLines={1}
        >
          {teamName}
        </Text>
        {team ? (
          <View style={styles.teamGroupActions}>
            <TeamChannelToggle
              teamId={team._id}
              teamName={team.name}
              hasChannel={team.hasChannel}
              channelMemberCount={team.memberCount}
            />
            {team.hasChannel && team.channelSlug ? (
              <Pressable
                onPress={() =>
                  router.push(
                    `/inbox/${groupId}/${team.channelSlug}` as never,
                  )
                }
                hitSlop={6}
                accessibilityRole="link"
                accessibilityLabel={`Open ${team.name} chat`}
              >
                <View style={styles.openChatRow}>
                  <Text
                    style={[
                      styles.openChatText,
                      { color: colors.buttonPrimary },
                    ]}
                  >
                    Open chat
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={colors.buttonPrimary}
                  />
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <ActivityIndicator size="small" color={colors.textTertiary} />
        )}
      </View>

      {roles.map((role) => (
        <RoleAssignmentCard
          key={role.roleId}
          role={role}
          onAssign={() => onAssign(role)}
          onUnassign={onUnassign}
        />
      ))}
    </View>
  );
}

/** One role's slots: filled assignments + open "+" slots. */
function RoleAssignmentCard({
  role,
  onAssign,
  onUnassign,
}: {
  role: EventRole;
  onAssign: () => void;
  onUnassign: (id: Id<"roleAssignments">) => void;
}) {
  const { colors } = useTheme();
  const swatch = role.roleColor ?? DEFAULT_ROLE_COLOR;

  // Non-declined assignments occupy slots; declined ones reopen a slot but
  // are still listed so the scheduler sees the decline and can refill.
  const active = role.assignments.filter((a) => a.status !== "declined");
  const declined = role.assignments.filter((a) => a.status === "declined");
  const openSlots = Math.max(0, role.needed - active.length);

  return (
    <View
      style={[styles.roleCard, { backgroundColor: colors.surfaceSecondary }]}
    >
      <View style={styles.roleCardHeader}>
        <View style={[styles.roleSwatch, { backgroundColor: swatch }]} />
        <Text style={[styles.roleCardName, { color: colors.text }]}>
          {role.roleName}
        </Text>
        <Text style={[styles.roleCardCount, { color: colors.textSecondary }]}>
          {active.length}/{role.needed}
        </Text>
      </View>

      {active.map((a) => (
        <SlotRow
          key={a._id}
          name={a.userName}
          status={a.status}
          colors={colors}
          onRemove={() => onUnassign(a._id)}
        />
      ))}

      {declined.map((a) => (
        <View key={a._id}>
          <SlotRow
            name={a.userName}
            status="declined"
            colors={colors}
            note={a.declineNote}
            onRemove={() => onUnassign(a._id)}
          />
        </View>
      ))}

      {Array.from({ length: openSlots }).map((_, i) => (
        <Pressable
          key={`open-${i}`}
          onPress={onAssign}
          style={({ pressed }) => [
            styles.openSlot,
            { borderColor: colors.border },
            pressed && { backgroundColor: colors.selectedBackground },
          ]}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.icon} />
          <Text style={[styles.openSlotText, { color: colors.textSecondary }]}>
            {declined.length > 0 ? "Refill this slot" : "Assign someone"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A single assigned-person row with a status indicator. */
function SlotRow({
  name,
  status,
  colors,
  note,
  onRemove,
}: {
  name: string;
  status: string;
  colors: ReturnType<typeof useTheme>["colors"];
  note?: string;
  onRemove: () => void;
}) {
  const config =
    status === "confirmed"
      ? { icon: "checkmark-circle" as const, color: colors.success, label: "Confirmed" }
      : status === "declined"
        ? { icon: "close-circle" as const, color: colors.destructive, label: "Declined" }
        : {
            icon: "ellipse-outline" as const,
            color: colors.textSecondary,
            label: "Awaiting",
          };
  return (
    <View style={styles.slotRow}>
      <Ionicons name={config.icon} size={20} color={config.color} />
      <View style={styles.slotTextWrap}>
        <Text style={[styles.slotName, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.slotStatus, { color: config.color }]}>
          {config.label}
          {note ? ` — "${note}"` : ""}
        </Text>
      </View>
      <Pressable onPress={onRemove} hitSlop={8} style={styles.slotRemove}>
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function Header({
  onBack,
  colors,
  onDelete,
}: {
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  onDelete?: () => void;
}) {
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Event plan</Text>
      {onDelete ? (
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={12}
          style={styles.headerBtn}
        >
          <Ionicons name="trash-outline" size={22} color={colors.destructive} />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerBtn} />
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 36,
    padding: 4,
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  titleInput: {
    fontSize: 22,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  autoSaveHint: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 12,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  actionValue: {
    fontSize: 14,
    fontWeight: "600",
  },
  noRolesText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 20,
  },
  teamGroup: {
    marginTop: 20,
  },
  teamGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    gap: 8,
  },
  teamGroupName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  teamGroupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  openChatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  openChatText: {
    fontSize: 13,
    fontWeight: "600",
  },
  roleCard: {
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  roleCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  roleSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  roleCardName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  roleCardCount: {
    fontSize: 13,
    fontWeight: "600",
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  slotTextWrap: {
    flex: 1,
  },
  slotName: {
    fontSize: 15,
    fontWeight: "500",
  },
  slotStatus: {
    fontSize: 12,
    marginTop: 1,
  },
  slotRemove: {
    padding: 4,
  },
  openSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    marginTop: 6,
  },
  openSlotText: {
    fontSize: 14,
  },
  publishBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  publishBtn: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  publishBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
