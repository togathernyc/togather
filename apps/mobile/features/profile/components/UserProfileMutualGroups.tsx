/**
 * Horizontal list of mutual groups between the viewer and the profile user.
 * Taps route to the group detail page via the `/g/[shortId]` share link
 * when present, falling back to the top-level group route.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AppImage } from '@components/ui';
import { useTheme } from '@hooks/useTheme';
import type { MutualGroup } from '../hooks/useUserProfile';

interface UserProfileMutualGroupsProps {
  groups: MutualGroup[];
}

export function UserProfileMutualGroups({ groups }: UserProfileMutualGroupsProps) {
  const router = useRouter();
  const { colors } = useTheme();

  if (groups.length === 0) return null;

  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Mutual groups
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {groups.map((g) => (
          <TouchableOpacity
            key={g._id}
            style={[styles.card, { backgroundColor: colors.surface }]}
            onPress={() => {
              if (g.shortId) {
                router.push(`/g/${g.shortId}`);
              } else {
                router.push(`/groups/${g._id}`);
              }
            }}
            activeOpacity={0.7}
          >
            <AppImage
              source={g.preview ?? undefined}
              style={styles.thumb}
              optimizedWidth={160}
              placeholder={{
                type: 'initials',
                name: g.name,
                backgroundColor: '#E5E5E5',
              }}
            />
            <Text
              style={[styles.name, { color: colors.text }]}
              numberOfLines={2}
            >
              {g.name}
            </Text>
            <Text
              style={[styles.count, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 140;

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  row: {
    gap: 10,
    paddingVertical: 2,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 12,
    padding: 10,
  },
  thumb: {
    width: CARD_WIDTH - 20,
    height: CARD_WIDTH - 20,
    borderRadius: 8,
    marginBottom: 8,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  count: {
    fontSize: 11,
  },
});
