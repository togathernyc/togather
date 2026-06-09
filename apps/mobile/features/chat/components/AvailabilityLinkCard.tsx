/**
 * AvailabilityLinkCard — native chat card for an `/a/<token>` availability link.
 *
 * Mounted from MessageItem when an availability link (`togather.nyc/a/<token>`)
 * is detected in a message, the same way `/e/` event links render an
 * EventLinkCard. Resolves the request by its public token, lets the (logged-in)
 * viewer respond inline, exposes a "Copy link" button, and opens the public
 * `/a/<token>` page. Mirrors AvailabilityRequestCardFromMessage, keyed by token.
 */
import React, { useCallback, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { DOMAIN_CONFIG } from '@togather/shared';
import type { Id } from '@services/api/convex';
import {
  api,
  useQuery,
  useStoredAuthToken,
  useAuthenticatedMutation,
} from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';
import { AvailabilityRequestCard } from './AvailabilityRequestCard';

interface Props {
  /** The `/a/<token>` public token from the link. */
  token: string;
}

export function AvailabilityLinkCard({ token: publicToken }: Props) {
  const { colors } = useTheme();
  const authToken = useStoredAuthToken();
  const router = useRouter();
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const request = useQuery(
    api.functions.messaging.availabilityRequests.getAvailabilityRequestByToken,
    authToken ? { token: authToken, publicToken } : 'skip',
  );

  const setMyAvailability = useAuthenticatedMutation(
    api.functions.scheduling.availability.setMyAvailability,
  );
  const clearMyAvailability = useAuthenticatedMutation(
    api.functions.scheduling.availability.clearMyAvailability,
  );

  const handleSetStatus = useCallback(
    async (planId: Id<'eventPlans'>, status: 'available' | 'unavailable') => {
      if (!request) return;
      // Non-members can't write availability directly — send them to the public
      // /a/ page, which handles SMS onboarding and recording.
      if (!request.isMember) {
        router.push(`/a/${publicToken}` as never);
        return;
      }
      const event = request.events.find((e) => e._id === planId);
      // Tapping the already-selected status toggles it off.
      const shouldClear = event?.myStatus === status;
      setBusyPlanId(planId);
      try {
        if (shouldClear) {
          await clearMyAvailability({ planId });
        } else {
          await setMyAvailability({ planId, status });
        }
      } catch (e) {
        const err = e as { data?: { message?: string }; message?: string };
        Alert.alert('Error', err?.data?.message ?? err?.message ?? 'Try again.');
      } finally {
        setBusyPlanId(null);
      }
    },
    [request, setMyAvailability, clearMyAvailability, router, publicToken],
  );

  if (request === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.link} />
      </View>
    );
  }
  if (request === null) {
    return null;
  }

  return (
    <AvailabilityRequestCard
      message={request.message}
      events={request.events}
      busyPlanId={busyPlanId}
      onSetStatus={handleSetStatus}
      canRespond={request.isMember}
      copyLinkUrl={DOMAIN_CONFIG.availabilityLinkUrl(publicToken)}
      onOpenPage={() => router.push(`/a/${publicToken}` as never)}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 16,
    alignItems: 'center',
  },
});
