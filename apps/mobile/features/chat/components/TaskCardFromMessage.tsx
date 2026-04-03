import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { Id } from "@services/api/convex";
import { api, useQuery, useStoredAuthToken } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ReachOutTaskCard } from "./ReachOutTaskCard";

interface TaskCardFromMessageProps {
  taskId: Id<"tasks">;
}

export function TaskCardFromMessage({ taskId }: TaskCardFromMessageProps) {
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();

  const task = useQuery(
    api.functions.tasks.index.getTaskCard,
    token ? { token, taskId } : "skip",
  );

  if (task === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }
  if (!task) {
    return null;
  }

  return (
    <ReachOutTaskCard
      task={task}
      variant={task.viewerCanManage ? "leader" : "member"}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 16,
    alignItems: "center",
  },
});
