import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { getRsvpStatsForOption } from "@features/chat/utils/rsvpStats";

const INITIAL_MODE = "initial";
const RELOADED_MODE = "reloaded";
const STORAGE_KEY = "playwright:rsvp-refresh-mode";

const initialRsvpData = {
  total: 12,
  rsvps: [
    {
      option: { id: 1 },
      count: 12,
      users: Array.from({ length: 12 }, (_, i) => ({ id: `user-${i + 1}` })),
    },
  ],
};

const reloadedRsvpData = {
  total: 12,
  rsvps: [
    {
      option: { id: 1 },
      count: 12,
      users: [{ id: "user-1" }],
    },
  ],
};

export default function EventRsvpRefreshTestScreen() {
  const [mode, setMode] = useState(INITIAL_MODE);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const currentMode = window.localStorage.getItem(STORAGE_KEY);
    setMode(currentMode === RELOADED_MODE ? RELOADED_MODE : INITIAL_MODE);
  }, []);

  const activeData = useMemo(
    () => (mode === RELOADED_MODE ? reloadedRsvpData : initialRsvpData),
    [mode]
  );
  const stats = useMemo(() => getRsvpStatsForOption(activeData, 1), [activeData]);

  return (
    <View style={styles.container} testID="rsvp-refresh-screen">
      <Text style={styles.title}>RSVP Refresh Regression Harness</Text>
      <Text testID="mode-value">Mode: {mode}</Text>
      <Text testID="preview-users-value">Preview Users: {stats.users.length}</Text>
      <Text testID="displayed-count-value">Displayed Count: {stats.count}</Text>
      <Text testID="percentage-value">Percentage: {Math.round(stats.percentage)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
});
