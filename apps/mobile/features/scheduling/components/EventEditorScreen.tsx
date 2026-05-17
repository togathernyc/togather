/**
 * EventEditorScreen
 *
 * The scheduler's per-event screen: edit title / date / time(s), declare
 * needed roles, assign people per role slot, and publish. Each role shows
 * its slots; a filled slot displays the volunteer and their status
 * (✓ Confirmed / … Awaiting / ✗ Declined). A declined slot offers an
 * inline "Refill" affordance. Tapping an open slot opens the assign sheet.
 *
 * Route: /(user)/leader-tools/[group_id]/scheduling/event/[plan_id]
 *
 * Backend: scheduling.events.getEvent / updateEvent / deleteEvent,
 * scheduling.assignments.unassign / publishEvent, NeededRolesModal +
 * AssignSheet for the sub-flows.
 */
import React, { useCallback, useMemo, useState } from "react";
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
import { DatePicker } from "@components/ui/DatePicker";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  formatEventDateLong,
  DEFAULT_ROLE_COLOR,
} from "../utils/format";
import { NeededRolesModal } from "./NeededRolesModal";
import { AssignSheet } from "./AssignSheet";

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
  channelId: Id<"chatChannels">;
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
    channelId: Id<"chatChannels">;
    roleId: Id<"teamRoles">;
    roleName: string;
  } | null>(null);

  // roleId -> needed count, fed into the needed-roles modal.
  const currentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const role of event?.roles ?? []) {
      map[`${role.channelId}|${role.roleId}`] = role.needed;
    }
    return map;
  }, [event?.roles]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === event?.title) return;
    try {
      await updateEvent({ planId, title: trimmed });
    } catch (e: any) {
      Alert.alert("Couldn't rename", e?.message ?? "Please try again.");
    }
  }, [titleDraft, event?.title, updateEvent, planId]);

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

  // Edits the single (first) time entry of the plan. Multi-time add/remove
  // is intentionally out of scope — any extra entries are left untouched.
  const handleChangeTime = useCallback(
    async (date: Date | null) => {
      if (!date || !event) return;
      const label = formatTimeLabel(date);
      const startsAt = date.getTime();
      const existing = event.times;
      const times =
        existing.length > 0
          ? existing.map((t, i) => (i === 0 ? { label, startsAt } : t))
          : [{ label, startsAt }];
      try {
        await updateEvent({ planId, times });
      } catch (e: any) {
        Alert.alert("Couldn't update time", e?.message ?? "Please try again.");
      }
    },
    [updateEvent, planId, event],
  );

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
            onChangeText={setTitleDraft}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
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

        {/* Date */}
        <View style={styles.dateRow}>
          <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
            {formatEventDateLong(event.eventDate)}
          </Text>
          <DatePicker
            value={new Date(event.eventDate)}
            onChange={handleChangeDate}
            mode="date"
          />
        </View>
        {/* Time — editable; edits the first/single entry. */}
        <View style={styles.dateRow}>
          <Text style={[styles.dateLabel, { color: colors.textSecondary }]}>
            {event.times.length > 0
              ? event.times.map((t) => t.label).join(" · ")
              : "Add a time"}
          </Text>
          <DatePicker
            value={
              event.times.length > 0
                ? new Date(event.times[0].startsAt)
                : new Date(event.eventDate)
            }
            onChange={handleChangeTime}
            mode="time"
          />
        </View>

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

        {/* Per-role assignment view */}
        {event.roles.length === 0 ? (
          <Text style={[styles.noRolesText, { color: colors.textSecondary }]}>
            No roles needed yet. Tap "Set needed roles" to declare how many of
            each role this event plan needs.
          </Text>
        ) : (
          event.roles.map((role) => (
            <RoleAssignmentCard
              key={role.roleId}
              role={role}
              onAssign={() =>
                setAssignTarget({
                  channelId: role.channelId,
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
          channelId={assignTarget.channelId}
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
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  dateLabel: {
    fontSize: 15,
    flex: 1,
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
