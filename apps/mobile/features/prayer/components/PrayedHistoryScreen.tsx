/**
 * PrayedHistoryScreen — full vertical list of every prayer the user has
 * prayed for in the current community. Reached via "See all" in the rail
 * under the prayer feed.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { PrayedCard } from './PrayedCard';

const FULL_LIMIT = 200;

export function PrayedHistoryScreen() {
  const router = useRouter();
  const { community } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const items = useAuthenticatedQuery(
    api.functions.prayers.myPrayedFor,
    community?.id
      ? { communityId: community.id as Id<'communities'>, limit: FULL_LIMIT }
      : 'skip',
  );

  const isLoading = items === undefined && !!community?.id;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Stack.Screen options={{ title: "Prayers you've prayed", headerShown: true }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={primaryColor} />
        </View>
      ) : !items || items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="heart-outline" size={36} color={colors.iconSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing here yet</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Prayers you pray for in your community will show up here so you can revisit them.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <PrayedCard
              prayer={item}
              onPress={() => router.push(`/(user)/prayed-for/${item.id}`)}
              variant="list"
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  emptyBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
});
