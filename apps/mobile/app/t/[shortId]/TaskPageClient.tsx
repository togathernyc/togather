"use client";

import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, api } from "@services/api/convex";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export default function TaskPageClient() {
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const router = useRouter();

  const linkData = useQuery(
    api.functions.toolShortLinks.index.getByShortId,
    shortId ? { shortId } : "skip",
  );

  useEffect(() => {
    if (!shortId || !linkData) return;

    if (linkData.toolType === "task") {
      if (typeof linkData.groupId === "string" && typeof linkData.taskId === "string") {
        router.replace(`/(user)/leader-tools/${linkData.groupId}/tasks/${linkData.taskId}`);
      }
      return;
    }

    // Graceful migration path: old /t tool links move to /r.
    router.replace(`/r/${shortId}`);
  }, [router, shortId, linkData]);

  if (linkData === undefined) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={styles.subtleText}>Resolving link...</Text>
      </SafeAreaView>
    );
  }

  if (linkData === null) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={64} color="#999" />
        <Text style={styles.title}>Link Not Found</Text>
        <Text style={styles.subtleText}>
          This shared link may have been removed or is invalid.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
      <Text style={styles.subtleText}>
        {linkData.toolType === "task" ? "Opening task..." : "Opening resource..."}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  subtleText: {
    marginTop: 12,
    fontSize: 15,
    color: "#666",
    textAlign: "center",
  },
});
