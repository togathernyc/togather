import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api, convexVanilla } from "@/services/api/convex";
import type { Id } from "@/services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

type AvailabilityStatus = "available" | "unavailable";

export default function AvailabilityPageScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();
  const { token } = useLocalSearchParams<{ token: string }>();

  const data = useQuery(
    api.functions.scheduling.publicAvailability.getPublicAvailabilityRequest,
    token ? { publicToken: token } : "skip",
  );

  const [responses, setResponses] = useState<
    Record<string, AvailabilityStatus>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const toggle = useCallback(
    (planId: string, status: AvailabilityStatus) => {
      setError("");
      setResponses((prev) => {
        const next = { ...prev };
        if (next[planId] === status) {
          delete next[planId];
        } else {
          next[planId] = status;
        }
        return next;
      });
    },
    [],
  );

  // Build the array of marked responses (only events with a selection).
  const responseArray = useMemo(
    () =>
      Object.entries(responses).map(([planId, status]) => ({
        planId: planId as Id<"eventPlans">,
        status,
      })),
    [responses],
  );

  const handleSave = useCallback(async () => {
    if (responseArray.length === 0) {
      setError("Please mark at least one date.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const authToken = await AsyncStorage.getItem("auth_token");
      if (!authToken) {
        throw new Error("Not authenticated: no auth token available");
      }
      await convexVanilla.mutation(
        api.functions.scheduling.publicAvailability
          .submitAvailabilityForRequest,
        {
          token: authToken,
          publicToken: token!,
          responses: responseArray,
        },
      );
      setSaved(true);
    } catch (err) {
      const e = err as { data?: { message?: string }; message?: string };
      setError(e.data?.message ?? e.message ?? "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [responseArray, token]);

  const handleContinue = useCallback(() => {
    if (responseArray.length === 0) {
      setError("Please mark at least one date.");
      return;
    }
    router.push({
      pathname: `/a/${token}/phone`,
      params: { responses: JSON.stringify(responseArray) },
    });
  }, [responseArray, router, token]);

  // Loading state
  if (data === undefined) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.surface }]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        </View>
      </SafeAreaView>
    );
  }

  // Link not found
  if (data === null) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.surface }]}
      >
        <View style={styles.centered}>
          <Ionicons name="link-outline" size={48} color={colors.textTertiary} />
          <Text style={[styles.notFoundTitle, { color: colors.text }]}>
            Link not found
          </Text>
          <Text
            style={[styles.notFoundMessage, { color: colors.textSecondary }]}
          >
            This availability link is no longer valid.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Success state (authenticated submit)
  if (saved) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.surface }]}
      >
        <View style={styles.centered}>
          <Ionicons
            name="checkmark-circle"
            size={64}
            color={colors.success}
          />
          <Text style={[styles.notFoundTitle, { color: colors.text }]}>
            You're all set!
          </Text>
          <Text
            style={[styles.notFoundMessage, { color: colors.textSecondary }]}
          >
            {data.groupName} has your availability.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const defaultMessage = `Let ${data.groupName} know which dates you can serve.`;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.surface }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerBlock}>
          <Text style={[styles.community, { color: colors.textTertiary }]}>
            {data.communityName}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Your availability
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {data.message || defaultMessage}
          </Text>
          <Text style={[styles.subNote, { color: colors.textTertiary }]}>
            Marking available is just a heads-up — your leader still builds the
            final schedule.
          </Text>
        </View>

        {data.events.map((event) => {
          const isAvailable = responses[event._id] === "available";
          const isUnavailable = responses[event._id] === "unavailable";
          const timeLabels = event.times.map((t) => t.label).join(", ");
          const dateLine = new Date(event.eventDate).toLocaleDateString(
            "en-US",
            { weekday: "short", month: "short", day: "numeric" },
          );
          return (
            <View
              key={event._id}
              style={[
                styles.card,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Text
                style={[styles.cardTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {event.title}
              </Text>
              <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
                {dateLine}
                {timeLabels ? ` · ${timeLabels}` : ""}
              </Text>

              <View style={styles.pillRow}>
                <Pressable
                  onPress={() => toggle(event._id, "available")}
                  style={({ pressed }) => [
                    styles.pill,
                    isAvailable
                      ? {
                          backgroundColor: colors.success,
                          borderColor: colors.success,
                        }
                      : {
                          backgroundColor: "transparent",
                          borderColor: colors.border,
                        },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: isAvailable ? "#fff" : colors.textSecondary },
                    ]}
                  >
                    Available
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => toggle(event._id, "unavailable")}
                  style={({ pressed }) => [
                    styles.pill,
                    isUnavailable
                      ? {
                          backgroundColor: colors.destructive,
                          borderColor: colors.destructive,
                        }
                      : {
                          backgroundColor: "transparent",
                          borderColor: colors.border,
                        },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: isUnavailable ? "#fff" : colors.textSecondary },
                    ]}
                  >
                    Can't make it
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.cta, isSubmitting && styles.ctaDisabled]}
          onPress={isAuthenticated ? handleSave : handleContinue}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {isAuthenticated ? "Save availability" : "Continue"}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notFoundTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 12,
    textAlign: "center",
  },
  notFoundMessage: {
    fontSize: 15,
    marginTop: 6,
    textAlign: "center",
  },
  scrollContent: {
    padding: 20,
    maxWidth: 500,
    width: "100%",
    alignSelf: "center",
  },
  headerBlock: {
    marginBottom: 20,
  },
  community: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 10,
  },
  message: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 10,
  },
  subNote: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardDate: {
    fontSize: 13,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
  },
  error: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
  },
  cta: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
