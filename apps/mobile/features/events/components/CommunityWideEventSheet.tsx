/**
 * CommunityWideEventSheet Component
 *
 * Bottom sheet that expands a community-wide event card into its per-group
 * child events. Opened from the Events tab when the user taps a
 * CommunityWideEventCard.
 *
 * The sheet is "controlled" via the `parentId` prop:
 *   - `parentId` non-null  → open, fetch children via getCommunityWideEventChildren
 *   - `parentId` null      → closed
 *
 * On web we fall back to a bottom panel overlay since @gorhom/bottom-sheet
 * has historically been finicky in that environment.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { format, toZonedTime } from 'date-fns-tz';
import { formatTimeWithTimezone } from '@togather/shared';
import { useQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { EventCard } from './EventCard';
import type { CommunityEvent } from '../hooks/useCommunityEvents';

const isWeb = Platform.OS === 'web';

interface CommunityWideEventSheetProps {
  parentId: Id<'communityWideEvents'> | null;
  onDismiss: () => void;
}

/**
 * Adapter: the backend returns `SingleEventCard` (kind: "single" with Convex
 * Id fields) but the existing EventCard component takes `CommunityEvent`
 * (string-id shape). At runtime Convex Ids are strings, so this is mostly a
 * type-level cast plus defaulting a couple of optional fields.
 */
function toCommunityEvent(child: any): CommunityEvent {
  return {
    id: child.id,
    shortId: child.shortId,
    title: child.title,
    scheduledAt: child.scheduledAt,
    status: child.status,
    visibility: child.visibility,
    coverImage: child.coverImage,
    locationOverride: child.locationOverride,
    meetingType: child.meetingType,
    rsvpEnabled: child.rsvpEnabled,
    communityWideEventId: child.communityWideEventId,
    group: {
      id: child.group.id,
      name: child.group.name,
      image: child.group.image,
      groupTypeName: child.group.groupTypeName,
      addressLine1: child.group.addressLine1,
      addressLine2: child.group.addressLine2,
      city: child.group.city,
      state: child.group.state,
      zipCode: child.group.zipCode,
    },
    rsvpSummary: {
      totalGoing: child.rsvpSummary.totalGoing,
      topGoingGuests: child.rsvpSummary.topGoingGuests,
    },
  };
}

export function CommunityWideEventSheet({
  parentId,
  onDismiss,
}: CommunityWideEventSheetProps) {
  const router = useRouter();
  const { user, token } = useAuth();
  const { colors } = useTheme();
  const bottomSheetRef = useRef<BottomSheet>(null);

  const snapPoints = useMemo(() => ['60%', '90%'], []);

  const userTimezone = user?.timezone || 'America/New_York';

  // Fire lookup only when sheet is open.
  const queryArgs = useMemo(() => {
    if (!parentId) return 'skip' as const;
    if (user?.id && !token) return 'skip' as const;
    const base = { parentId };
    if (user?.id && token) return { ...base, token };
    return base;
  }, [parentId, user?.id, token]);

  const result = useQuery(
    api.functions.meetings.events.getCommunityWideEventChildren,
    queryArgs
  );
  const isLoading = parentId !== null && result === undefined;
  const parent = result?.parent ?? null;
  const children = result?.children ?? [];

  // Open/close the sheet when parentId flips.
  useEffect(() => {
    if (isWeb) return;
    if (parentId) {
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [parentId]);

  const handleChildPress = useCallback(
    (shortId: string | null) => {
      if (!shortId) return;
      router.push(`/e/${shortId}?source=app`);
      onDismiss();
    },
    [router, onDismiss]
  );

  // Header with parent title + scheduledAt
  const header = parent ? (
    <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={2}>
        {parent.title}
      </Text>
      <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
        {(() => {
          const zoned = toZonedTime(new Date(parent.scheduledAt), userTimezone);
          const date = format(zoned, 'EEE, MMM d', { timeZone: userTimezone });
          const time = formatTimeWithTimezone(new Date(parent.scheduledAt), userTimezone);
          return `${date} · ${time}`;
        })()}
      </Text>
    </View>
  ) : null;

  const body = (
    <>
      {header}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : children.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={32} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No locations available.
          </Text>
        </View>
      ) : (
        children.map((child: any) => {
          const adapted = toCommunityEvent(child);
          return (
            <View key={String(child.id)} style={styles.cardWrapper}>
              <EventCard
                event={adapted}
                onPress={() => handleChildPress(adapted.shortId)}
              />
            </View>
          );
        })
      )}
    </>
  );

  // Web fallback: simple overlay panel
  if (isWeb) {
    if (!parentId) return null;
    return (
      <View style={styles.webOverlay} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.webBackdrop}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={[styles.webPanel, { backgroundColor: colors.surface }]}>
          <View style={styles.webHandleRow}>
            <View style={[styles.webHandle, { backgroundColor: colors.border }]} />
            <TouchableOpacity style={styles.webCloseButton} onPress={onDismiss}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.webScrollWrapper}>
            <View style={styles.listContent}>{body}</View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={parentId ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onDismiss}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.surface }]}
    >
      <BottomSheetScrollView contentContainerStyle={styles.listContent}>
        {body}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  handleIndicator: {
    width: 40,
    height: 4,
  },
  sheetBackground: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  header: {
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
  cardWrapper: {
    // Nothing extra — EventCard has its own styling.
  },
  // Web-only styles
  webOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  webPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0px -4px 16px rgba(0, 0, 0, 0.1)',
      },
      default: {},
    }),
  },
  webHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    position: 'relative',
  },
  webHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  webCloseButton: {
    position: 'absolute',
    right: 12,
    top: 6,
    padding: 6,
  },
  webScrollWrapper: {
    maxHeight: '100%',
  },
});
