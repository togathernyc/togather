import { useRouter, usePathname } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { View, ActivityIndicator, Platform } from "react-native";
import { useEffect, useRef } from "react";

/**
 * UserRoute - For user pages that require authentication
 * Equivalent to Next.js UserRoute HOC
 */
export function UserRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirectedRef = useRef(false);
  const redirectingRef = useRef(false);

  useEffect(() => {
    console.log("🔒 UserRoute: useEffect triggered", {
      isAuthenticated,
      isLoading,
      pathname,
      hasRedirected: hasRedirectedRef.current,
      redirecting: redirectingRef.current,
    });

    // Get current pathname inside effect to check without adding to dependencies
    const currentPathname = pathname;

    // CRITICAL: UserRoute is only for (user) routes. If we're not on a (user) route,
    // don't do anything - let the index page handle routing via useInitialRouting.
    // This prevents issues on Android where Expo Router pre-renders all layouts.
    if (
      currentPathname === "/" ||
      currentPathname === "/signin" ||
      currentPathname === "/(auth)/signin" ||
      currentPathname.includes("/signin") ||
      currentPathname.startsWith("/(auth)") ||
      currentPathname.startsWith("/(landing)") ||
      currentPathname.startsWith("/(tabs)")
    ) {
      console.log(
        "🔒 UserRoute: Not on a (user) route, letting index handle routing"
      );
      return;
    }

    // CRITICAL: Check hasRedirected FIRST before any other logic
    if (hasRedirectedRef.current) {
      console.log("🔒 UserRoute: Already redirected, skipping");
      return;
    }

    // Prevent multiple redirects
    if (redirectingRef.current) {
      console.log("🔒 UserRoute: Already redirecting, skipping");
      return;
    }

    // Only redirect if not loading and not authenticated
    if (!isLoading && !isAuthenticated) {
      console.log("🔒 UserRoute: Not authenticated, redirecting to /");
      redirectingRef.current = true;
      hasRedirectedRef.current = true; // Set BEFORE redirect to prevent loops

      // Use setTimeout to defer redirect to next event loop tick
      // This prevents the redirect from causing an immediate re-render loop
      const timeoutId = setTimeout(() => {
        try {
          console.log("🔒 UserRoute: Executing redirect to /");
          // On web, use window.location.href to avoid router re-render loops
          // On native, use router.replace
          if (Platform.OS === "web") {
            window.location.href = "/";
          } else {
            router.replace("/");
          }
        } catch (error) {
          console.error("🔒 UserRoute: Redirect error:", error);
          hasRedirectedRef.current = false; // Reset on error so we can retry
        } finally {
          redirectingRef.current = false;
        }
      }, 50); // Small delay to prevent immediate re-render loop

      return () => clearTimeout(timeoutId);
    } else {
      console.log("🔒 UserRoute: No redirect needed", {
        isLoading,
        isAuthenticated,
        pathname: currentPathname,
      });
    }
    // Use pathname inside effect, don't add to dependencies to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, router]);

  console.log("🔒 UserRoute: Rendering", {
    isAuthenticated,
    isLoading,
    pathname,
    hasRedirected: hasRedirectedRef.current,
  });

  // CRITICAL: If we're not on a (user) route, don't show spinners or block rendering.
  // This handles Expo Router pre-rendering layouts on Android.
  const isUserRoute = pathname.startsWith("/(user)") || pathname.includes("(user)");
  if (!isUserRoute && pathname !== "") {
    console.log("🔒 UserRoute: Not on (user) route, rendering children directly");
    return <>{children}</>;
  }

  if (isLoading) {
    console.log("🔒 UserRoute: Showing loading spinner (isLoading=true)");
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    console.log("🔒 UserRoute: Showing loading spinner (not authenticated)");
    // Show loading while redirecting
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  console.log("🔒 UserRoute: Rendering children (authenticated)");
  return <>{children}</>;
}
