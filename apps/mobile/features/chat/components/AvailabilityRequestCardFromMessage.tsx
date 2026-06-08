/**
 * AvailabilityRequestCardFromMessage — wrapper that fetches an availability
 * request by id and wires the set/clear availability mutations to
 * AvailabilityRequestCard.
 *
 * Mounted from MessageItem when contentType === "availability_request". The
 * underlying `getAvailabilityRequest` query is reactive, so each event's
 * `myStatus` and the summary count update the moment the viewer taps a pill.
 */
import React, { useCallback, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { Id } from '@services/api/convex';
import { api, useQuery, useStoredAuthToken, useAuthenticatedMutation } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';
import { AvailabilityRequestCard } from './AvailabilityRequestCard';

interface Props {
  requestId: Id<'availabilityRequests'>;
}

export function AvailabilityRequestCardFromMessage({ requestId }: Props) {
  const { colors } = useTheme();
  const token = useStoredAuthToken();
  const router = useRouter();
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const request = useQuery(
    api.functions.messaging.availabilityRequests.getAvailabilityRequest,
    token ? { token, requestId } : 'skip',
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
    [request, setMyAvailability, clearMyAvailability],
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
      onOpenPage={() =>
        router.push(`/rostering/${request.groupId}/availability` as never)
      }
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 16,
    alignItems: 'center',
  },
});
