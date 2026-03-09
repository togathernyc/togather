import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname, useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";
import { useAuth } from "@providers/AuthProvider";
import { getInitialRouteTarget } from "./initialRouteTarget";

/**
 * Hook to handle initial routing based on authentication state
 * Redirects to appropriate route (home or signin)
 */
export function useInitialRouting() {
  const { isAuthenticated, isLoading, community, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const hasRedirectedRef = useRef(false);
  const redirectingRef = useRef(false);

  // Add safety timeout - force redirect after 3 seconds even if loading
  const [forceShow, setForceShow] = useState(false);
  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      console.warn("Index: Loading timeout, forcing redirect");
      setForceShow(true);
    }, 3000); // 3 second timeout
    return () => clearTimeout(safetyTimeout);
  }, []);

  // Handle redirects programmatically to prevent infinite loops
  useEffect(() => {
    // Get current pathname inside effect to check without adding to dependencies
    const currentPathname = pathname;

    // CRITICAL: Check for OAuth callback parameters BEFORE any redirects
    // If OAuth parameters are present, we must NOT redirect - let the OAuth flow complete
    const isOAuthCallback =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      (window.location.search.includes("code=") ||
        window.location.search.includes("error="));

    console.log("📄 Index: Redirect effect triggered", {
      isAuthenticated,
      isLoading,
      pathname: currentPathname,
      hasRedirected: hasRedirectedRef.current,
      redirecting: redirectingRef.current,
      forceShow,
      communityId: community?.id,
      userId: user?.id,
      isAdmin: user?.is_admin,
      isOAuthCallback,
      search:
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.search
          : null,
    });

    // CRITICAL: Don't redirect if OAuth callback is in progress
    // The OAuth flow needs to complete on the root path to process the callback
    if (isOAuthCallback) {
      console.log(
        "📄 Index: OAuth callback detected - DO NOT REDIRECT, let OAuth flow complete"
      );
      return;
    }

    // CRITICAL: Check hasRedirected FIRST before any other logic
    if (hasRedirectedRef.current) {
      console.log("📄 Index: Already redirected, skipping");
      return;
    }

    // Prevent multiple redirects
    if (redirectingRef.current) {
      console.log("📄 Index: Already redirecting, skipping");
      return;
    }

    // Don't redirect if we're already on the target page (chat/inbox, signin, or profile)
    // This prevents infinite loops when index redirects to chat and UserRoute redirects back
    if (
      currentPathname === "/(tabs)/chat" ||
      currentPathname === "/chat" ||
      currentPathname.includes("/chat") ||
      currentPathname === "/(auth)/signin" ||
      currentPathname.includes("/signin") ||
      currentPathname === "/(tabs)/profile" ||
      currentPathname.includes("/profile")
    ) {
      console.log("📄 Index: Already on target page, skipping redirect");
      hasRedirectedRef.current = true;
      return;
    }

    // Don't redirect while loading (unless forceShow is true)
    if (isLoading && !forceShow) {
      console.log("📄 Index: Still loading, skipping redirect");
      return;
    }

    const targetPath = getInitialRouteTarget({
      isAuthenticated,
      hasCommunity: !!community,
      hasSlugParam: !!params.slug,
      hasUserProfile: !!user,
    });

    if (targetPath === "/(tabs)/chat") {
      console.log(
        "📄 Index: Authenticated with community, redirecting to",
        targetPath
      );
    } else if (isAuthenticated && targetPath === "/(tabs)/profile") {
      console.log(
        "📄 Index: Authenticated without profile/community (offline-safe), redirecting to profile"
      );
    } else {
      console.log("📄 Index: Redirecting to signin");
    }

    console.log(
      "📄 Index: Setting redirect flags and scheduling redirect to",
      targetPath
    );
    redirectingRef.current = true;
    hasRedirectedRef.current = true; // Set BEFORE redirect to prevent loops

    // Use setTimeout to defer redirect to next event loop tick
    // This prevents the redirect from causing an immediate re-render loop
    const timeoutId = setTimeout(() => {
      try {
        console.log("📄 Index: Executing redirect to", targetPath);
        // Use router.replace for both web and native to ensure Expo Router paths work correctly
        // window.location.href doesn't work with Expo Router route groups like (auth)
        router.replace(targetPath);
      } catch (error) {
        console.error("📄 Index: Redirect error:", error);
        hasRedirectedRef.current = false; // Reset on error so we can retry
      } finally {
        redirectingRef.current = false;
      }
    }, 50); // Small delay to prevent immediate re-render loop

    return () => clearTimeout(timeoutId);
    // Use pathname inside effect, don't add to dependencies to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, community, params.slug, forceShow, router, user]);

  return {
    isLoading,
    forceShow,
  };
}
