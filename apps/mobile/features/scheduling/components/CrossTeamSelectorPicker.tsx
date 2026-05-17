/**
 * CrossTeamSelectorPicker
 *
 * Builds the `selectors` array for a cross-team channel. Each selector pairs a
 * source serving-team channel with an optional role on that team — omitting
 * the role means "anyone assigned any role on this team".
 *
 * The leader expands a team to reveal its roles, then taps "Any role" or one
 * or more specific roles. Each tap toggles a selector in/out of the chosen
 * list. Chosen selectors are shown as removable chips.
 *
 * Backend: scheduling.teams.listTeamChannels (source teams) +
 * scheduling.roles.listRoles (roles per team). The resulting `selectors`
 * array is consumed by createCrossTeamChannel / updateCrossTeamChannel.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR } from "../utils/format";
import type { CrossTeamSelector } from "../api/crossTeamChannels";

type TeamChannel = {
  _id: Id<"chatChannels">;
  name: string;
  channelType: string;
  memberCount: number;
};

type Role = {
  _id: Id<"teamRoles">;
  name: string;
  color?: string;
  sortOrder: number;
  defaultNeeded?: number;
  isArchived: boolean;
};

type Props = {
  groupId: Id<"groups">;
  /** Current selectors — fully controlled by the parent. */
  selectors: CrossTeamSelector[];
  onChange: (selectors: CrossTeamSelector[]) => void;
  /** Disables all interaction (e.g. while a create/update is in flight). */
  disabled?: boolean;
};

/** Two selectors are equal iff they point at the same team + same role. */
function sameSelector(a: CrossTeamSelector, b: CrossTeamSelector): boolean {
  return a.sourceChannelId === b.sourceChannelId && a.roleId === b.roleId;
}

export function CrossTeamSelectorPicker({
  groupId,
  selectors,
  onChange,
  disabled,
}: Props) {
  const { colors } = useTheme();

  const teams = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeamChannels,
    { groupId },
  ) as TeamChannel[] | undefined;

  // Which team rows are expanded to show their roles.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpanded = useCallback((channelId: string) => {
    setExpanded((prev) => ({ ...prev, [channelId]: !prev[channelId] }));
  }, []);

  const toggleSelector = useCallback(
    (selector: CrossTeamSelector) => {
      if (disabled) return;
      const exists = selectors.some((s) => sameSelector(s, selector));
      onChange(
        exists
          ? selectors.filter((s) => !sameSelector(s, selector))
          : [...selectors, selector],
      );
    },
    [disabled, selectors, onChange],
  );

  if (teams === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (teams.length === 0) {
    return (
      <View
        style={[styles.emptyBox, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Ionicons
          name="people-circle-outline"
          size={28}
          color={colors.textSecondary}
        />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          This group has no serving teams yet. Set up at least one serving-team
          channel with roles before creating a cross-team channel.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/* Chosen selectors */}
      {selectors.length > 0 && (
        <View style={styles.chipWrap}>
          {selectors.map((selector) => (
            <SelectorChip
              key={`${selector.sourceChannelId}:${selector.roleId ?? "any"}`}
              selector={selector}
              teams={teams}
              groupId={groupId}
              onRemove={() => toggleSelector(selector)}
              disabled={disabled}
            />
          ))}
        </View>
      )}

      {/* Team list */}
      <View
        style={[styles.teamGroup, { backgroundColor: colors.surfaceSecondary }]}
      >
        {teams.map((team, idx) => (
          <TeamRow
            key={team._id}
            team={team}
            isExpanded={!!expanded[team._id]}
            isFirst={idx === 0}
            selectors={selectors}
            onToggleExpanded={() => toggleExpanded(team._id)}
            onToggleSelector={toggleSelector}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  );
}

/** A single team row — header tap expands its roles. */
function TeamRow({
  team,
  isExpanded,
  isFirst,
  selectors,
  onToggleExpanded,
  onToggleSelector,
  disabled,
}: {
  team: TeamChannel;
  isExpanded: boolean;
  isFirst: boolean;
  selectors: CrossTeamSelector[];
  onToggleExpanded: () => void;
  onToggleSelector: (selector: CrossTeamSelector) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  // Count how many selectors target this team — surfaced as a badge.
  const teamSelectorCount = selectors.filter(
    (s) => s.sourceChannelId === team._id,
  ).length;

  return (
    <View
      style={
        !isFirst && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        }
      }
    >
      <Pressable
        onPress={onToggleExpanded}
        disabled={disabled}
        style={({ pressed }) => [
          styles.teamRow,
          pressed && { backgroundColor: colors.selectedBackground },
        ]}
      >
        <Ionicons
          name="people-outline"
          size={20}
          color={colors.textSecondary}
        />
        <Text
          style={[styles.teamName, { color: colors.text }]}
          numberOfLines={1}
        >
          {team.name}
        </Text>
        {teamSelectorCount > 0 && (
          <View style={[styles.countBadge, { backgroundColor: colors.text }]}>
            <Text style={[styles.countBadgeText, { color: colors.surface }]}>
              {teamSelectorCount}
            </Text>
          </View>
        )}
        <Ionicons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textTertiary}
        />
      </Pressable>

      {isExpanded && (
        <TeamRoles
          channelId={team._id}
          selectors={selectors}
          onToggleSelector={onToggleSelector}
          disabled={disabled}
        />
      )}
    </View>
  );
}

/** Role options for an expanded team: "Any role" + each specific role. */
function TeamRoles({
  channelId,
  selectors,
  onToggleSelector,
  disabled,
}: {
  channelId: Id<"chatChannels">;
  selectors: CrossTeamSelector[];
  onToggleSelector: (selector: CrossTeamSelector) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { channelId },
  ) as Role[] | undefined;

  const isChosen = useCallback(
    (roleId?: Id<"teamRoles">) =>
      selectors.some(
        (s) => s.sourceChannelId === channelId && s.roleId === roleId,
      ),
    [selectors, channelId],
  );

  if (roles === undefined) {
    return (
      <View style={styles.rolesLoading}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={styles.rolesWrap}>
      <RoleOption
        label="Any role on this team"
        color={colors.textSecondary}
        selected={isChosen(undefined)}
        onPress={() => onToggleSelector({ sourceChannelId: channelId })}
        disabled={disabled}
      />
      {roles.map((role) => (
        <RoleOption
          key={role._id}
          label={role.name}
          color={role.color ?? DEFAULT_ROLE_COLOR}
          selected={isChosen(role._id)}
          onPress={() =>
            onToggleSelector({ sourceChannelId: channelId, roleId: role._id })
          }
          disabled={disabled}
        />
      ))}
      {roles.length === 0 && (
        <Text style={[styles.noRolesText, { color: colors.textTertiary }]}>
          This team has no roles yet. "Any role on this team" still works.
        </Text>
      )}
    </View>
  );
}

/** A single tappable role option (checkbox-style). */
function RoleOption({
  label,
  color,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.roleOption,
        pressed && { backgroundColor: colors.selectedBackground },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={[styles.roleSwatch, { backgroundColor: color }]} />
      <Text style={[styles.roleOptionLabel, { color: colors.text }]}>
        {label}
      </Text>
      <Ionicons
        name={selected ? "checkbox" : "square-outline"}
        size={22}
        color={selected ? colors.text : colors.textTertiary}
        style={{ marginLeft: "auto" }}
      />
    </Pressable>
  );
}

/** A removable chip for one chosen selector. */
function SelectorChip({
  selector,
  teams,
  groupId,
  onRemove,
  disabled,
}: {
  selector: CrossTeamSelector;
  teams: TeamChannel[];
  groupId: Id<"groups">;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  const teamName =
    teams.find((t) => t._id === selector.sourceChannelId)?.name ??
    "Unknown team";

  // Fetch the source team's roles only to resolve the chosen role's name.
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    selector.roleId ? { channelId: selector.sourceChannelId } : "skip",
  ) as Role[] | undefined;

  const roleLabel = selector.roleId
    ? (roles?.find((r) => r._id === selector.roleId)?.name ?? "Role")
    : "Any role";

  // groupId is accepted for API symmetry with the picker; unused here.
  void groupId;

  return (
    <View style={[styles.chip, { backgroundColor: colors.selectedBackground }]}>
      <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
        {teamName} — {roleLabel}
      </Text>
      <Pressable onPress={onRemove} disabled={disabled} hitSlop={8}>
        <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 16,
  },
  emptyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
  },
  teamGroup: {
    borderRadius: 12,
    overflow: "hidden",
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 48,
  },
  teamName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rolesLoading: {
    paddingVertical: 12,
    alignItems: "center",
  },
  rolesWrap: {
    paddingBottom: 8,
    paddingLeft: 12,
  },
  roleOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  roleSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  roleOptionLabel: {
    fontSize: 15,
  },
  noRolesText: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    lineHeight: 16,
  },
});
