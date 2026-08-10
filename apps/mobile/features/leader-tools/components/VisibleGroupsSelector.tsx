import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery as useConvexQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

interface VisibleGroupsSelectorProps {
  communityId: string;
  /** The hosting group — always has access, so it's excluded from the list. */
  hostGroupId?: string;
  /** Currently selected group ids. */
  value: string[];
  onChange: (groupIds: string[]) => void;
}

/**
 * Multi-select checklist of community groups for the "Specific Groups"
 * visibility level. Members of the hosting group plus any selected group can
 * see and RSVP, so the hosting group is omitted here.
 */
export function VisibleGroupsSelector({
  communityId,
  hostGroupId,
  value,
  onChange,
}: VisibleGroupsSelectorProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const groups = useConvexQuery(
    api.functions.groups.queries.listByCommunity,
    communityId
      ? {
          communityId: communityId as Id<"communities">,
          includePrivate: true,
          limit: 200,
        }
      : "skip"
  );

  const selectableGroups = useMemo(
    () => (groups ?? []).filter((g: any) => g._id !== hostGroupId),
    [groups, hostGroupId]
  );

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (groupId: string) => {
    const next = new Set(selected);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    onChange(Array.from(next));
  };

  if (groups === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }

  if (selectableGroups.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.textSecondary }]}>
        No other groups available to share with.
      </Text>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.helper, { color: colors.textSecondary }]}>
        Choose which groups can see and RSVP to this event.
      </Text>
      {selectableGroups.map((group: any) => {
        const isSelected = selected.has(group._id);
        return (
          <TouchableOpacity
            key={group._id}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.border },
              isSelected && { borderColor: primaryColor, backgroundColor: colors.surfaceSecondary },
            ]}
            onPress={() => toggle(group._id)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: colors.border },
                isSelected && { borderColor: primaryColor, backgroundColor: primaryColor },
              ]}
            >
              {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
              {group.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginTop: 8,
  },
  helper: {
    fontSize: 13,
    marginBottom: 2,
  },
  loading: {
    paddingVertical: 16,
    alignItems: "center",
  },
  empty: {
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 2,
    padding: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  label: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
});
