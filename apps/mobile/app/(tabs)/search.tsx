import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExploreScreen } from "@features/explore/components";

function MapErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Map unavailable</Text>
        <Text style={styles.message}>
          {Platform.OS === "android"
            ? "The map could not be loaded on this device. A fix is on the way."
            : "Something went wrong loading the map."}
        </Text>
        <TouchableOpacity style={styles.button} onPress={resetError}>
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ExploreScreenWithBoundary() {
  // Legacy deep-link compat: the old Explore tab bundled groups + events
  // behind a `?view=events` param. After the split (ADR-022) those links
  // live on the Events tab. Redirect once so old push-notification / chat
  // / email links keep working. Remove in a follow-up once call sites are
  // updated.
  const params = useLocalSearchParams<{ view?: string; mode?: string }>();
  const wantsEvents = params.view === "events" || params.mode === "events";

  if (wantsEvents) {
    return <Redirect href="/(tabs)/events" />;
  }

  return (
    <ErrorBoundary FallbackComponent={MapErrorFallback}>
      <ExploreScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 20,
  },
  content: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
