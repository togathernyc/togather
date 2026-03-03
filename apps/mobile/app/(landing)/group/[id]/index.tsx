import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api, Id } from "@services/api/convex";
import { useJoinIntent } from "@features/auth";
import { useAuth } from "@/providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

const DAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/**
 * Formats meeting schedule from day number and time string
 */
function formatSchedule(day: number | null | undefined, timeIso: string | null | undefined): string | null {
  if (day === null || day === undefined || day < 0 || day > 6) return null;

  const dayName = DAY_NAMES[day];
  if (!dayName) return null;

  if (!timeIso) return dayName;

  try {
    // Parse ISO time string and format to 12-hour
    const date = new Date(timeIso);
    if (isNaN(date.getTime())) return dayName;

    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const period = hours >= 12 ? "pm" : "am";
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, "0");

    return `${dayName} at ${displayHours}:${displayMinutes}${period}`;
  } catch {
    return dayName;
  }
}

/**
 * Public group detail page - accessible without authentication
 * Used from the nearme feature to show group info before sign-up
 */
export default function PublicGroupDetailScreen() {
  const router = useRouter();
  const { id, subdomain } = useLocalSearchParams<{ id: string; subdomain: string }>();
  const { setJoinIntent } = useJoinIntent();
  const { isAuthenticated, user, isLoading: isAuthLoading } = useAuth();

  // Query returns undefined while loading, data when ready, or throws on error
  const group = useQuery(
    api.functions.groupSearch.publicGroupDetail,
    id && subdomain
      ? {
          groupId: id as Id<"groups">,
          communitySubdomain: subdomain,
        }
      : "skip"
  );

  // Convex useQuery returns undefined while loading
  const isLoading = group === undefined && !!id && !!subdomain;
  // Error handling - Convex throws errors, caught by error boundary
  // For now, we treat no data after loading completes as an error
  const error = group === null;

  const handleJoinPress = async () => {
    // Store join intent before navigating
    // After auth completes (or immediately if already authenticated), this intent will be consumed to:
    // 1. Show community join confirmation
    // 2. Auto-submit group join request
    if (id && subdomain) {
      await setJoinIntent(id, subdomain);
    }

    // If already authenticated, skip signin and go directly to join flow
    if (isAuthenticated && user) {
      router.push("/(auth)/join-flow");
    } else {
      router.push("/signin");
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/nearme?subdomain=${subdomain}`);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
        <Text style={styles.loadingText}>Loading group...</Text>
      </View>
    );
  }

  if (error || !group) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#999" />
          <Text style={styles.errorTitle}>Group Not Found</Text>
          <Text style={styles.errorMessage}>
            This group doesn't exist or is no longer available.
          </Text>
          <TouchableOpacity style={styles.backLink} onPress={handleBack}>
            <Text style={styles.backLinkText}>Go back to search</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {group.community.logo && (
            <Image source={{ uri: group.community.logo }} style={styles.communityLogo} />
          )}
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Group Image */}
        {group.preview && (
          <Image source={{ uri: group.preview }} style={styles.groupImage} />
        )}

        {/* Group Info */}
        <View style={styles.infoSection}>
          <Text style={styles.groupType}>{group.groupTypeName}</Text>
          <Text style={styles.groupName}>{group.name}</Text>

          {/* Location */}
          {(group.city || group.state) && (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={18} color="#666" />
              <Text style={styles.metaText}>
                {[group.city, group.state].filter(Boolean).join(", ")}
              </Text>
            </View>
          )}

          {/* Meeting Schedule */}
          {formatSchedule(group.defaultDay, group.defaultStartTime) && (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={18} color="#666" />
              <Text style={styles.metaText}>
                {formatSchedule(group.defaultDay, group.defaultStartTime)}
              </Text>
            </View>
          )}

          {/* Member Count */}
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={18} color="#666" />
            <Text style={styles.metaText}>
              {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
            </Text>
          </View>

          {/* On Break Notice */}
          {group.isOnBreak && (
            <View style={styles.breakNotice}>
              <Ionicons name="pause-circle-outline" size={20} color="#f39c12" />
              <Text style={styles.breakText}>
                This group is currently on break
                {group.breakUntil && ` until ${new Date(group.breakUntil).toLocaleDateString()}`}
              </Text>
            </View>
          )}

          {/* Description */}
          {group.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.description}>{group.description}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Join CTA */}
      <View style={styles.ctaContainer}>
        <TouchableOpacity
          style={[styles.joinButton, isAuthLoading && styles.joinButtonLoading]}
          onPress={handleJoinPress}
          disabled={isAuthLoading}
        >
          {isAuthLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.joinButtonText}>
              {isAuthenticated && user ? "Request to Join" : "Sign in to Join"}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.ctaNote}>
          {isAuthLoading
            ? "Checking your account..."
            : isAuthenticated && user
              ? "You'll be asked to confirm joining this community"
              : "Sign in or create an account to request to join this group"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: Platform.OS === "ios" ? 60 : 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  communityLogo: {
    width: 32,
    height: 32,
    borderRadius: 6,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 24,
  },
  backLink: {
    marginTop: 24,
    padding: 12,
  },
  backLinkText: {
    color: DEFAULT_PRIMARY_COLOR,
    fontSize: 16,
    fontWeight: "500",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  groupImage: {
    width: "100%",
    height: 200,
    backgroundColor: "#f0f0f0",
  },
  infoSection: {
    padding: 20,
  },
  groupType: {
    fontSize: 14,
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  groupName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
    marginTop: 4,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  metaText: {
    fontSize: 16,
    color: "#666",
  },
  breakNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef9e7",
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
  },
  breakText: {
    flex: 1,
    fontSize: 14,
    color: "#b7950b",
  },
  descriptionSection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: "#555",
    lineHeight: 24,
  },
  ctaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  joinButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  joinButtonLoading: {
    opacity: 0.7,
  },
  joinButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  ctaNote: {
    textAlign: "center",
    fontSize: 12,
    color: "#999",
    marginTop: 8,
  },
});
