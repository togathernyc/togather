/**
 * Hook to manage Planning Center OAuth authentication flow.
 *
 * Handles initiating OAuth, opening browser, and managing connection/disconnection.
 * Uses Convex mutations for the backend OAuth flow (following best practices).
 */

import { useState, useCallback } from "react";
import { Alert, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation } from "convex/react";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DOMAIN_CONFIG } from "@togather/shared";

// Ensure WebBrowser auth session is dismissed properly on web
if (Platform.OS === "web") {
  WebBrowser.maybeCompleteAuthSession();
}

/**
 * Get the appropriate redirect URI based on platform.
 * - Mobile: Uses deep link (togather://planning-center/callback)
 * - Web: Uses HTTPS callback URL
 */
function getRedirectUri(): string {
  if (Platform.OS === "web") {
    // For web, use the current origin with the callback path
    const origin = typeof window !== "undefined" ? window.location.origin : DOMAIN_CONFIG.appUrl;
    return `${origin}/planning-center/callback`;
  }
  // For mobile, use the deep link
  return "togather://planning-center/callback";
}

/**
 * Parse OAuth callback URL to extract code and state
 */
function parseCallbackUrl(url: string): { code?: string; state?: string; error?: string } {
  try {
    const urlObj = new URL(url);
    return {
      code: urlObj.searchParams.get("code") || undefined,
      state: urlObj.searchParams.get("state") || undefined,
      error: urlObj.searchParams.get("error") || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Start Planning Center OAuth flow.
 *
 * Opens a browser to the Planning Center authorization page.
 * After authorization, completes the OAuth flow and stores credentials.
 */
export function usePlanningCenterAuth() {
  const [isPending, setIsPending] = useState(false);
  const { token, community } = useAuth();

  const startPlanningCenterAuth = useMutation(api.functions.integrations.startPlanningCenterAuthMutation);
  const completePlanningCenterAuth = useMutation(api.functions.integrations.completePlanningCenterAuthMutation);

  const mutateAsync = useCallback(async (options?: { forceLogin?: boolean }): Promise<{ type: "success" | "cancel" | "error" | "redirect" }> => {
    if (!token || !community?.id) {
      Alert.alert("Error", "Please sign in to connect Planning Center.");
      return { type: "error" };
    }

    setIsPending(true);
    try {
      const redirectUri = getRedirectUri();

      // Get the authorization URL from Convex
      const authResult = await startPlanningCenterAuth({
        token,
        communityId: community.id as Id<"communities">,
        redirectUri,
        forceLogin: options?.forceLogin,
      });

      if (!authResult.authorizationUrl) {
        Alert.alert("Error", "Failed to start Planning Center authorization.");
        return { type: "error" };
      }

      // Open the authorization URL in a browser
      if (Platform.OS === "web") {
        // On web, redirect to the authorization URL
        // The callback page will handle completing the flow
        window.location.href = authResult.authorizationUrl;
        return { type: "redirect" };
      }

      // On mobile, open in a browser
      // When forceLogin is true, use preferEphemeralSession to open a private session
      // This prevents the browser from using cached cookies/sessions
      const browserResult = await WebBrowser.openAuthSessionAsync(
        authResult.authorizationUrl,
        redirectUri,
        options?.forceLogin ? { preferEphemeralSession: true } : undefined
      );

      if (browserResult.type === "cancel" || browserResult.type === "dismiss") {
        return { type: "cancel" };
      }

      if (browserResult.type !== "success" || !browserResult.url) {
        Alert.alert("Error", "OAuth authorization failed. Please try again.");
        return { type: "error" };
      }

      // Parse the callback URL to get code and state
      const { code, state, error } = parseCallbackUrl(browserResult.url);

      if (error) {
        Alert.alert(
          "Authorization Denied",
          error === "access_denied"
            ? "You denied access to Planning Center. Please try again if you want to connect."
            : `OAuth error: ${error}`
        );
        return { type: "error" };
      }

      if (!code || !state) {
        Alert.alert("Error", "Missing authorization code. Please try again.");
        return { type: "error" };
      }

      // Complete the OAuth flow
      const completeResult = await completePlanningCenterAuth({
        token,
        communityId: community.id as Id<"communities">,
        code,
        state,
      });

      if (completeResult.success) {
        Alert.alert("Success", "Planning Center connected successfully!");
        return { type: "success" };
      } else {
        Alert.alert("Error", "Failed to connect Planning Center. Please try again.");
        return { type: "error" };
      }
    } catch (error) {
      console.error("Planning Center auth error:", error);
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to connect to Planning Center. Please try again."
      );
      return { type: "error" };
    } finally {
      setIsPending(false);
    }
  }, [token, community?.id, startPlanningCenterAuth, completePlanningCenterAuth]);

  return {
    mutateAsync,
    isPending,
  };
}

/**
 * Disconnect Planning Center integration.
 */
export function useDisconnectPlanningCenter() {
  const [isPending, setIsPending] = useState(false);
  const { token, community } = useAuth();

  const disconnectPlanningCenter = useMutation(api.functions.integrations.disconnectPlanningCenterMutation);

  const mutateAsync = useCallback(async () => {
    if (!token || !community?.id) {
      Alert.alert("Error", "Please sign in to disconnect Planning Center.");
      return;
    }

    setIsPending(true);
    try {
      const result = await disconnectPlanningCenter({
        token,
        communityId: community.id as Id<"communities">,
      });

      if (result.success) {
        Alert.alert("Success", "Planning Center disconnected successfully.");
      }
    } catch (error) {
      console.error("Disconnect error:", error);
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to disconnect Planning Center. Please try again."
      );
    } finally {
      setIsPending(false);
    }
  }, [token, community?.id, disconnectPlanningCenter]);

  // Sync wrapper for mutateAsync (for backwards compatibility)
  const mutate = useCallback(() => {
    mutateAsync();
  }, [mutateAsync]);

  return {
    mutate,
    mutateAsync,
    isPending,
  };
}
