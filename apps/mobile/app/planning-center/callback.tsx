/**
 * Planning Center OAuth Callback Route
 *
 * Handles the OAuth redirect from Planning Center after user authorizes.
 * Works for both:
 * - Web: https://app.togather.nyc/planning-center/callback
 * - Mobile: togather://planning-center/callback
 *
 * Extracts the authorization code and state from URL params,
 * completes the OAuth flow via Convex, and redirects to the integrations page.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

export default function PlanningCenterCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const { token, community } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const completePlanningCenterAuth = useMutation(api.functions.integrations.completePlanningCenterAuthMutation);

  useEffect(() => {
    async function handleCallback() {
      // Check for OAuth error from Planning Center
      if (params.error) {
        setStatus("error");
        setErrorMessage(params.error === "access_denied"
          ? "Authorization was denied. Please try again."
          : `OAuth error: ${params.error}`
        );
        return;
      }

      // Validate required params
      if (!params.code || !params.state) {
        setStatus("error");
        setErrorMessage("Missing authorization code or state. Please try again.");
        return;
      }

      // Validate auth context
      if (!token || !community?.id) {
        setStatus("error");
        setErrorMessage("Not authenticated. Please sign in and try again.");
        return;
      }

      try {
        // Complete the OAuth flow
        const result = await completePlanningCenterAuth({
          token,
          communityId: community.id as Id<"communities">,
          code: params.code,
          state: params.state,
        });

        if (result.success) {
          setStatus("success");
          // Redirect to integrations page after short delay
          setTimeout(() => {
            router.replace("/(user)/leader-tools/integrations/planning-center");
          }, 1500);
        } else {
          setStatus("error");
          setErrorMessage("Failed to connect Planning Center. Please try again.");
        }
      } catch (error) {
        console.error("Planning Center OAuth error:", error);
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred. Please try again."
        );
      }
    }

    handleCallback();
  }, [params.code, params.state, params.error, token, community?.id]);

  return (
    <View style={styles.container}>
      {status === "loading" && (
        <>
          <ActivityIndicator size="large" color="#222224" />
          <Text style={styles.text}>Connecting to Planning Center...</Text>
        </>
      )}

      {status === "success" && (
        <>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.text}>Planning Center connected successfully!</Text>
          <Text style={styles.subtext}>Redirecting...</Text>
        </>
      )}

      {status === "error" && (
        <>
          <Text style={styles.errorIcon}>✕</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Text
            style={styles.linkText}
            onPress={() => router.replace("/(user)/leader-tools/integrations/planning-center")}
          >
            Go back to integrations
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fafafa",
    padding: 20,
  },
  text: {
    marginTop: 20,
    fontSize: 18,
    color: "#222224",
    textAlign: "center",
  },
  subtext: {
    marginTop: 8,
    fontSize: 14,
    color: "#666668",
  },
  successIcon: {
    fontSize: 64,
    color: "#34C759",
  },
  errorIcon: {
    fontSize: 64,
    color: "#FF3B30",
  },
  errorText: {
    marginTop: 20,
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    lineHeight: 24,
  },
  linkText: {
    marginTop: 24,
    fontSize: 16,
    color: "#007AFF",
    textDecorationLine: "underline",
  },
});
