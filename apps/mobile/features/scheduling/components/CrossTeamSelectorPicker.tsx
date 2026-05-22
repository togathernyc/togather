/**
 * CrossTeamSelectorPicker
 *
 * Builds the `selectors` array for a cross-team channel. Each selector pairs a
 * source serving team with an optional role on that team — omitting the role
 * means "anyone assigned any role on this team".
 *
 * Two-step flow: the leader first chooses which groups to draw from, then —
 * for each chosen group — expands a team to pick "Any role" or specific roles.
 * Groups can sit on different campuses; only the chosen groups (those that
 * actually contribute a team) end up sharing the channel. Chosen selectors are
 * shown as removable chips.
 *
 * Backend: scheduling.teams.listCommunityTeams returns every group in the
 * community that has a serving team, each team enriched with its roles. The
 * resulting `selectors` array is consumed by createCrossTeamChannel /
 * updateCrossTeamChannel.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

type Role = {
  _id: Id<"teamRoles">;
  name: string;
  color?: string;
  sortOrder: number;
};

type Team = {
  _id: Id<"teams">;
  name: string;
  hasChannel: boolean;
  memberCount: number;
  roles: Role[];
};

type CommunityGroup = {
  group: { _id: Id<"groups">; name: string };
  teams: Team[];
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
  return a.sourceTeamId === b.sourceTeamId && a.roleId === b.roleId;
}

export function CrossTeamSelectorPicker({
  groupId,
  selectors,
  onChange,
  disabled,
}: Props) {
  const { colors } = useTheme();

  const communityGroups = useAuthenticatedQuery(
    api.functions.scheduling.teams.listCommunityTeams,
    { groupId },
  ) as CommunityGroup[] | undefined;

  // Lookups derived from the loaded data.
  const { teamToGroup, teamById } = useMemo(() => {
    const teamToGroup = new Map<string, string>();
    const teamById = new Map<string, Team>();
    for (const cg of communityGroups ?? []) {
      for (const team of cg.teams) {
        teamToGroup.set(team._id, cg.group._id);
        teamById.set(team._id, team);
      }
    }
    return { teamToGroup, teamById };
  }, [communityGroups]);

  // Step 1: which groups are open for role-picking.
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(new Set());
  // Step 2: which team rows are expanded to reveal their roles.
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // Any group already referenced by an existing selector must stay open so the
  // leader can see (and edit) what they previously chose.
  useEffect(() => {
    if (!communityGroups) return;
    const implied = new Set<string>();
    for (const selector of selectors) {
      const g = teamToGroup.get(selector.sourceTeamId);
      if (g) implied.add(g);
    }
    if (implied.size === 0) return;
    setOpenGroupIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const g of implied) {
        if (!next.has(g)) {
          next.add(g);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [communityGroups, selectors, teamToGroup]);

  const toggleGroup = useCallback(
    (cg: CommunityGroup) => {
      if (disabled) return;
      const isOpen = openGroupIds.has(cg.group._id);
      if (isOpen) {
        // Closing a group drops every selector pointing at one of its teams.
        const teamIds = new Set(cg.teams.map((t) => t._id));
        const remaining = selectors.filter(
          (s) => !teamIds.has(s.sourceTeamId),
        );
        if (remaining.length !== selectors.length) onChange(remaining);
      }
      setOpenGroupIds((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(cg.group._id);
        else next.add(cg.group._id);
        return next;
      });
    },
    [disabled, openGroupIds, selectors, onChange],
  );

  const toggleTeamExpanded = useCallback((teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
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

  if (communityGroups === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (communityGroups.length === 0) {
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
          No group in this community has a serving team yet. Create at least one
          serving team with roles before creating a cross-team channel.
        </Text>
      </View>
    );
  }

  const openGroups = communityGroups.filter((cg) =>
    openGroupIds.has(cg.group._id),
  );

  return (
    <View>
      {/* Chosen selectors */}
      {selectors.length > 0 && (
        <View style={styles.chipWrap}>
          {selectors.map((selector) => (
            <SelectorChip
              key={`${selector.sourceTeamId}:${selector.roleId ?? "any"}`}
              selector={selector}
              teamById={teamById}
              onRemove={() => toggleSelector(selector)}
              disabled={disabled}
            />
          ))}
        </View>
      )}

      {/* Step 1: choose groups */}
      <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>
        1. Choose groups to draw from
      </Text>
      <View
        style={[styles.teamGroup, { backgroundColor: colors.surfaceSecondary }]}
      >
        {communityGroups.map((cg, idx) => (
          <GroupRow
            key={cg.group._id}
            communityGroup={cg}
            isOpen={openGroupIds.has(cg.group._id)}
            isFirst={idx === 0}
            selectors={selectors}
            onToggle={() => toggleGroup(cg)}
            disabled={disabled}
          />
        ))}
      </View>

      {/* Step 2: choose roles within the chosen groups */}
      {openGroups.length > 0 && (
        <>
          <Text
            style={[
              styles.stepLabel,
              { color: colors.textSecondary, marginTop: 20 },
            ]}
          >
            2. Choose roles
          </Text>
          {openGroups.map((cg) => (
            <View key={cg.group._id} style={styles.groupSection}>
              <Text
                style={[styles.groupSectionTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {cg.group.name}
              </Text>
              <View
                style={[
                  styles.teamGroup,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                {cg.teams.map((team, idx) => (
                  <TeamRow
                    key={team._id}
                    team={team}
                    isExpanded={expandedTeams.has(team._id)}
                    isFirst={idx === 0}
                    selectors={selectors}
                    onToggleExpanded={() => toggleTeamExpanded(team._id)}
                    onToggleSelector={toggleSelector}
                    disabled={disabled}
                  />
                ))}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** A single group row in step 1 — checkbox-style toggle. */
function GroupRow({
  communityGroup,
  isOpen,
  isFirst,
  selectors,
  onToggle,
  disabled,
}: {
  communityGroup: CommunityGroup;
  isOpen: boolean;
  isFirst: boolean;
  selectors: CrossTeamSelector[];
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  // How many selectors target a team in this group — surfaced as a badge.
  const teamIds = new Set(communityGroup.teams.map((t) => t._id));
  const groupSelectorCount = selectors.filter((s) =>
    teamIds.has(s.sourceTeamId),
  ).length;

  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.teamRow,
        !isFirst && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        pressed && { backgroundColor: colors.selectedBackground },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Ionicons
        name={isOpen ? "checkbox" : "square-outline"}
        size={22}
        color={isOpen ? colors.text : colors.textTertiary}
      />
      <Text style={[styles.teamName, { color: colors.text }]} numberOfLines={1}>
        {communityGroup.group.name}
      </Text>
      {groupSelectorCount > 0 && (
        <View style={[styles.countBadge, { backgroundColor: colors.text }]}>
          <Text style={[styles.countBadgeText, { color: colors.surface }]}>
            {groupSelectorCount}
          </Text>
        </View>
      )}
      <Text style={[styles.teamMeta, { color: colors.textTertiary }]}>
        {communityGroup.teams.length} team
        {communityGroup.teams.length === 1 ? "" : "s"}
      </Text>
    </Pressable>
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
  team: Team;
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
    (s) => s.sourceTeamId === team._id,
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
        <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
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
          team={team}
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
  team,
  selectors,
  onToggleSelector,
  disabled,
}: {
  team: Team;
  selectors: CrossTeamSelector[];
  onToggleSelector: (selector: CrossTeamSelector) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  const isChosen = useCallback(
    (roleId?: Id<"teamRoles">) =>
      selectors.some(
        (s) => s.sourceTeamId === team._id && s.roleId === roleId,
      ),
    [selectors, team._id],
  );

  return (
    <View style={styles.rolesWrap}>
      <RoleOption
        label="Any role on this team"
        color={colors.textSecondary}
        selected={isChosen(undefined)}
        onPress={() => onToggleSelector({ sourceTeamId: team._id })}
        disabled={disabled}
      />
      {team.roles.map((role) => (
        <RoleOption
          key={role._id}
          label={role.name}
          color={role.color ?? DEFAULT_ROLE_COLOR}
          selected={isChosen(role._id)}
          onPress={() =>
            onToggleSelector({ sourceTeamId: team._id, roleId: role._id })
          }
          disabled={disabled}
        />
      ))}
      {team.roles.length === 0 && (
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
  teamById,
  onRemove,
  disabled,
}: {
  selector: CrossTeamSelector;
  teamById: Map<string, Team>;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  const team = teamById.get(selector.sourceTeamId);
  const teamName = team?.name ?? "Unknown team";
  const roleLabel = selector.roleId
    ? (team?.roles.find((r) => r._id === selector.roleId)?.name ?? "Role")
    : "Any role";

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
  stepLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  groupSection: {
    marginTop: 12,
  },
  groupSectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
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
  teamMeta: {
    fontSize: 13,
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
