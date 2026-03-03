import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState } from "@components/ui/EmptyState";
import { GroupCard } from "./GroupCard";
import { Group } from "../types";

interface GroupsListProps {
  groups: Group[];
  user: any;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function GroupsList({ groups, user }: GroupsListProps) {
  const router = useRouter();

  if (groups.length === 0) {
    return (
      <EmptyState
        icon="people-outline"
        title="No groups found"
        message="Join a group or create a new one to get started"
        actionLabel="Find a Group"
        onAction={() => router.push("/(user)/dinner-party-search")}
      />
    );
  }

  return (
    <View style={styles.listContent}>
      {groups.map((item) => {
        if (!item || !item.id) return null;

        return <GroupCard key={item.id} group={item} user={user} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: 12,
  },
});
