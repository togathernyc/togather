import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Group, GroupMember } from '@features/groups/types';
import { getGroupTypeLabel } from '@features/groups/utils';
import { useAuth } from '@providers/AuthProvider';
import { Avatar, AppImage } from '@components/ui';
import { useTheme } from '@hooks/useTheme';
import { COLORS, getGroupTypeColor } from '../constants';

interface GroupCardProps {
  group: Group;
  onPress?: (group: Group) => void;
  variant?: 'large' | 'compact';
}

const { width: screenWidth } = Dimensions.get('window');

export function GroupCard({ group, onPress, variant = 'large' }: GroupCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  // Prefer group_type_name from API, fallback to ID lookup
  const typeLabel = getGroupTypeLabel(group.group_type_name ?? group.group_type ?? group.type ?? 1, user);
  const previewUrl = group.preview || group.image_url;
  const hasImage = !!previewUrl;
  const groupName = group.title || group.name || 'Untitled Group';

  const members: GroupMember[] = group.members || [];
  const membersCount = group.members_count || members.length;
  const maxVisibleAvatars = 3;
  const visibleMembers = members.slice(0, maxVisibleAvatars);
  const remainingCount = membersCount > maxVisibleAvatars ? membersCount - maxVisibleAvatars : 0;

  // Get color based on group type - use dynamic function for any ID
  const typeColor = getGroupTypeColor(group.group_type ?? group.type);

  // Get location string
  const getLocationString = () => {
    if (group.city && group.state) {
      return `${group.city}, ${group.state}`;
    }
    if (group.location) {
      return group.location;
    }
    if (group.full_address) {
      return group.full_address;
    }
    return null;
  };

  const locationString = getLocationString();

  // Get initials for placeholder image
  const getInitials = () => {
    const name = groupName.trim();
    if (!name) return 'G';
    const parts = name.split(' ').filter((p) => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name[0]?.toUpperCase() || 'G';
  };

  // Get the group ID for navigation - prefer Convex _id, fallback to legacy id
  const getGroupId = useCallback(() => {
    return group._id || group.id;
  }, [group._id, group.id]);


  const handlePress = useCallback(() => {
    if (onPress) {
      onPress(group);
    } else {
      // Use Convex _id for navigation, fallback to uuid/id for legacy
      const groupId = getGroupId();
      router.push(`/groups/${groupId}`);
    }
  }, [group, onPress, router, getGroupId]);

  if (variant === 'compact') {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.compactContainer,
          { backgroundColor: colors.surface },
          pressed && styles.containerPressed,
        ]}
        onPress={handlePress}
      >
        {/* Image */}
        <View
          style={[
            styles.compactImageContainer,
            { backgroundColor: colors.backgroundSecondary },
          ]}
        >
          <AppImage
            source={previewUrl}
            style={styles.compactImage}
            resizeMode="cover"
            optimizedWidth={200}
            placeholder={{
              type: 'initials',
              name: groupName,
              backgroundColor: typeColor,
            }}
          />
        </View>

        {/* Info */}
        <View style={styles.compactInfo}>
          <Text style={[styles.compactName, { color: colors.text }]} numberOfLines={1}>
            {groupName}
          </Text>
          {locationString && (
            <Text
              style={[styles.compactLocation, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {locationString}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  // Large variant (Airbnb-style card)
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.surface },
        pressed && styles.containerPressed,
      ]}
      onPress={handlePress}
    >
      {/* Full-width Image */}
      <View
        style={[styles.imageContainer, { backgroundColor: colors.backgroundSecondary }]}
      >
        <AppImage
          source={previewUrl}
          style={styles.image}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: 'initials',
            name: groupName,
            backgroundColor: typeColor,
          }}
        />

        {/* Type Badge - overlaid on image */}
        {typeLabel && (
          <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
            <Text style={styles.typeText}>{typeLabel}</Text>
          </View>
        )}
      </View>

      {/* Info Section */}
      <View style={styles.infoSection}>
        <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={2}>
          {groupName}
        </Text>

        {locationString && (
          <Text
            style={[styles.locationText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {locationString}
          </Text>
        )}

        {/* Members Row */}
        {membersCount > 0 && (
          <View style={styles.membersRow}>
            <View style={styles.avatarsContainer}>
              {visibleMembers.map((member, index) => (
                <View
                  key={member.id || index}
                  style={[
                    styles.avatarWrapper,
                    index > 0 && styles.avatarOverlap,
                  ]}
                >
                  <Avatar
                    name={`${member.first_name || ''} ${member.last_name || ''}`.trim()}
                    imageUrl={member.profile_photo}
                    size={24}
                  />
                </View>
              ))}
              {remainingCount > 0 && (
                <Text style={[styles.membersCountText, { color: colors.textSecondary }]}>
                  +{remainingCount}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Large variant styles
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  containerPressed: {
    opacity: 0.9,
  },
  imageContainer: {
    width: '100%',
    height: 180,
    backgroundColor: '#f0f0f0',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 48,
    fontWeight: '600',
    color: '#fff',
  },
  typeBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoSection: {
    padding: 12,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  locationText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    marginRight: 0,
  },
  avatarOverlap: {
    marginLeft: -8,
  },
  membersCountText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginLeft: 8,
  },

  // Compact variant styles
  compactContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.06)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }),
  },
  compactImageContainer: {
    width: 80,
    height: 80,
    backgroundColor: '#f0f0f0',
  },
  compactImage: {
    width: '100%',
    height: '100%',
  },
  compactPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPlaceholderText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
  },
  compactInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  compactName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  compactLocation: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});
