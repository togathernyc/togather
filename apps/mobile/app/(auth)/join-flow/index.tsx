import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import { useJoinIntent, useSelectCommunity } from "@features/auth";
import { useAuth } from "@/providers/AuthProvider";
import { storage } from "@togather/shared/utils";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

type FlowStep = "loading" | "confirm_community" | "joining" | "success" | "error";

/**
 * Join flow screen - handles the community + group join flow after auth
 *
 * Flow:
 * 1. Load pending join intent (groupId, subdomain)
 * 2. Fetch community and group info
 * 3. Show "Join Community" confirmation
 * 4. After confirming, join community and submit group request
 * 5. Navigate to group detail page
 */
export default function JoinFlowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const { consumeJoinIntent } = useJoinIntent();

  const [step, setStep] = useState<FlowStep>("loading");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch group details (includes community info) using Convex
  const group = useQuery(
    api.functions.groupSearch.publicGroupDetail,
    groupId && subdomain
      ? { groupId: groupId as Id<"groups">, communitySubdomain: subdomain }
      : "skip"
  );
  const groupLoading = group === undefined && !!groupId && !!subdomain;
  const groupError = group instanceof Error ? group : null;

  // Select community hook (wraps the Convex action)
  const selectCommunityMutation = useSelectCommunity();

  // Join group mutation
  const createJoinRequest = useAuthenticatedMutation(api.functions.groupMembers.createJoinRequest);

  // Load intent on mount
  useEffect(() => {
    loadIntent();
  }, []);

  const loadIntent = async () => {
    const intent = await consumeJoinIntent();
    if (intent) {
      setGroupId(intent.groupId);
      setSubdomain(intent.subdomain);
      setStep("confirm_community");
    } else {
      // No intent found, go to regular app
      router.replace("/(tabs)/chat");
    }
  };

  // Handle errors from group fetch
  useEffect(() => {
    if (groupError) {
      setError("Could not load group information");
      setStep("error");
    }
  }, [groupError]);

  const handleJoinCommunity = async () => {
    if (!group?.community) return;

    setStep("joining");
    setError(null);

    try {
      // Join/select the community using the Convex selectCommunity hook
      await selectCommunityMutation.mutateAsync({
        communityId: String(group.community.id),
      });

      // Refresh user context
      await refreshUser();

      // Now submit the group join request
      try {
        await createJoinRequest({
          groupId: groupId as Id<"groups">,
        });
      } catch (joinError: any) {
        // If already a member or request pending, that's fine - continue to success
        if (joinError?.message?.includes("already")) {
          console.log("User already has membership/request for this group");
        } else {
          // Re-throw so outer catch can handle it properly
          console.error("Failed to create join request:", joinError);
          throw joinError;
        }
      }

      setStep("success");

      // Navigate to explore tab after a brief delay - this puts the user in the full app experience with tabs
      setTimeout(() => {
        router.replace("/(tabs)/search");
      }, 1500);
    } catch (err: any) {
      console.error("Join flow error:", err);
      setError(err?.message || "Failed to join community");
      setStep("error");
    }
  };

  const handleCancel = () => {
    // Go to regular app flow
    router.replace("/(tabs)/chat");
  };

  const handleRetry = () => {
    setStep("confirm_community");
    setError(null);
  };

  // Loading state
  if (step === "loading" || groupLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (step === "error") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={64} color="#e74c3c" />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleCancel}>
              <Text style={styles.secondaryButtonText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Success state
  if (step === "success") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Ionicons name="checkmark-circle" size={80} color="#27ae60" />
          <Text style={styles.successTitle}>You're in!</Text>
          <Text style={styles.successMessage}>
            Welcome to {group?.community?.name}. Your request to join the group has been submitted.
          </Text>
        </View>
      </View>
    );
  }

  // Joining state
  if (step === "joining") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={styles.loadingText}>Joining community...</Text>
        </View>
      </View>
    );
  }

  // Confirm community state
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
          <Ionicons name="close" size={28} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Community Info */}
        <View style={styles.communityCard}>
          {group?.community?.logo ? (
            <Image source={{ uri: group.community.logo }} style={styles.communityLogo} />
          ) : (
            <View style={[styles.communityLogo, styles.communityLogoPlaceholder]}>
              <Ionicons name="people" size={40} color={DEFAULT_PRIMARY_COLOR} />
            </View>
          )}
          <Text style={styles.communityName}>{group?.community?.name}</Text>
        </View>

        <Text style={styles.title}>Join this community</Text>
        <Text style={styles.subtitle}>
          To join <Text style={styles.bold}>{group?.name}</Text>, you need to be a member of{" "}
          <Text style={styles.bold}>{group?.community?.name}</Text>.
        </Text>

        {/* Group Preview */}
        <View style={styles.groupPreview}>
          <Text style={styles.groupPreviewLabel}>You're requesting to join:</Text>
          <View style={styles.groupPreviewCard}>
            {group?.preview && (
              <Image source={{ uri: group.preview }} style={styles.groupImage} />
            )}
            <View style={styles.groupInfo}>
              <Text style={styles.groupType}>{group?.groupTypeName}</Text>
              <Text style={styles.groupName}>{group?.name}</Text>
              {(group?.city || group?.state) && (
                <Text style={styles.groupLocation}>
                  {[group.city, group.state].filter(Boolean).join(", ")}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* CTA */}
      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.joinButton} onPress={handleJoinCommunity}>
          <Text style={styles.joinButtonText}>Join {group?.community?.name}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={handleCancel}>
          <Text style={styles.skipButtonText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  errorMessage: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  primaryButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  secondaryButtonText: {
    color: "#333",
    fontSize: 16,
    fontWeight: "500",
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
    marginTop: 16,
  },
  successMessage: {
    fontSize: 16,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 16,
  },
  closeButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  communityCard: {
    alignItems: "center",
    marginBottom: 32,
  },
  communityLogo: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: 12,
  },
  communityLogoPlaceholder: {
    backgroundColor: "#f0e6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  communityName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  bold: {
    fontWeight: "600",
    color: "#333",
  },
  groupPreview: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
  },
  groupPreviewLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  groupPreviewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  groupInfo: {
    flex: 1,
  },
  groupType: {
    fontSize: 12,
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "500",
    textTransform: "uppercase",
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 2,
  },
  groupLocation: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  ctaContainer: {
    padding: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  joinButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  joinButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  skipButtonText: {
    color: "#666",
    fontSize: 16,
  },
});
