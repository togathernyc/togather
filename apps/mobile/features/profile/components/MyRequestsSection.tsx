import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Card } from "@components/ui";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { useTheme } from "@hooks/useTheme";
import {
  useMyPendingJoinRequests,
  type PendingJoinRequest,
} from "@features/groups/hooks/useMyPendingJoinRequests";
import { useCancelJoinRequest } from "@features/groups/hooks/useGroups";
import { formatError } from "@/utils/error-handling";

/**
 * "My Requests" section on the profile page.
 *
 * Lists the user's pending join requests within the active community and lets
 * them withdraw any of them. Hidden entirely when the user has no pending
 * requests so the profile page doesn't grow unnecessary chrome.
 *
 * Anchored with `nativeID="my-requests"` so the PendingRequestLimitModal can
 * deep-link to it (and so on web the URL fragment `#my-requests` works).
 */
export function MyRequestsSection() {
  const { colors } = useTheme();
  const { requests, isLoading } = useMyPendingJoinRequests();
  const cancelJoinRequest = useCancelJoinRequest();
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingJoinRequest | null>(null);

  // We use ConfirmModal (built on the cross-platform CustomModal) instead of
  // Alert.alert here because react-native-web's Alert is a no-op — multi-button
  // alerts silently do nothing on web, which would make the Withdraw button
  // appear broken when the profile page is rendered in a browser.
  const handleWithdraw = (request: PendingJoinRequest) => {
    setPendingConfirm(request);
  };

  const confirmWithdraw = async () => {
    const request = pendingConfirm;
    if (!request) return;
    setPendingConfirm(null);
    setWithdrawingId(request.id);
    try {
      await cancelJoinRequest({ groupId: request.groupId });
    } catch (error) {
      Alert.alert(
        "Error",
        formatError(error, "Failed to withdraw request. Please try again.")
      );
    } finally {
      setWithdrawingId(null);
    }
  };

  // Hide the entire section when the user has no pending requests AND we're
  // not still loading. This keeps the profile page uncluttered for the common
  // case while still showing a placeholder during the brief loading window.
  if (!isLoading && requests.length === 0) {
    return null;
  }

  return (
    <View nativeID="my-requests">
      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>
          My Requests
        </Text>

        {isLoading && requests.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.icon} />
          </View>
        ) : (
          requests.map((request, index) => {
            const isLast = index === requests.length - 1;
            const isWithdrawing = withdrawingId === request.id;
            return (
              <View
                key={request.id}
                style={[
                  styles.row,
                  !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.rowText}>
                  <Text
                    style={[styles.groupName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {request.groupName}
                  </Text>
                  {!!request.groupTypeName && (
                    <Text
                      style={[styles.groupType, { color: colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {request.groupTypeName}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.withdrawButton,
                    { borderColor: colors.border },
                  ]}
                  onPress={() => handleWithdraw(request)}
                  disabled={isWithdrawing}
                  accessibilityRole="button"
                  accessibilityLabel={`Withdraw request to join ${request.groupName}`}
                >
                  {isWithdrawing ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <Text style={[styles.withdrawText, { color: colors.text }]}>
                      Withdraw
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </Card>

      <ConfirmModal
        visible={pendingConfirm !== null}
        title="Withdraw request"
        message={
          pendingConfirm
            ? `Withdraw your request to join ${pendingConfirm.groupName}?`
            : ""
        }
        confirmText="Withdraw"
        cancelText="Cancel"
        destructive
        onConfirm={confirmWithdraw}
        onCancel={() => setPendingConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 4,
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "500",
  },
  groupType: {
    fontSize: 13,
    marginTop: 2,
  },
  withdrawButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  withdrawText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
