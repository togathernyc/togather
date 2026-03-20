/**
 * ChannelInviteLinkCard - Inline smart card for channel invite links in chat
 *
 * Displays a compact card when a channel invite URL is detected in a message.
 * Shows channel name, group name, and appropriate action based on user's status.
 *
 * Layout: [icon] #channelName | groupName [action]
 * Follows ToolLinkCard's compact single-row pattern.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

interface ChannelInviteLinkCardProps {
  shortId: string;
  groupId?: Id<"groups">;
}

export function ChannelInviteLinkCard({ shortId, groupId }: ChannelInviteLinkCardProps) {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [justJoined, setJustJoined] = useState(false);

  // Load auth token on mount
  React.useEffect(() => {
    AsyncStorage.getItem('auth_token').then(setAuthToken);
  }, []);

  // Fetch channel info
  const channelData = useQuery(
    api.functions.messaging.channelInvites.getByShortId,
    shortId ? { shortId, token: authToken ?? undefined } : "skip"
  );

  // Join mutation
  const joinViaInviteLink = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.joinViaInviteLink
  );

  const isLoading = channelData === undefined;
  const error = channelData === null;

  // Handle card tap — navigate to channel if member, or to share page otherwise
  const handlePress = () => {
    if (!channelData) return;

    const effectiveStatus = justJoined ? "already_member" : channelData.userStatus;

    if (effectiveStatus === "already_member") {
      const targetGroupId = channelData.groupId || groupId;
      if (targetGroupId && channelData.channelSlug) {
        router.push(`/inbox/${targetGroupId}/${channelData.channelSlug}` as any);
      }
    } else {
      // Navigate to the full share page for non-members
      router.push(`/ch/${shortId}`);
    }
  };

  // Handle inline join action
  const handleJoin = async () => {
    setIsJoining(true);
    try {
      const result = await joinViaInviteLink({ shortId });
      if (result.joined) {
        setJustJoined(true);
        // Navigate to channel
        if (result.groupId && result.channelSlug) {
          router.push(`/inbox/${result.groupId}/${result.channelSlug}` as any);
        }
      } else if (result.requested) {
        Alert.alert(
          "Request Sent",
          "Your request to join this channel has been sent."
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to join channel");
    } finally {
      setIsJoining(false);
    }
  };

  // Render action button/badge on the right side
  const renderAction = () => {
    if (!channelData) return null;

    const effectiveStatus = justJoined ? "already_member" : channelData.userStatus;

    switch (effectiveStatus) {
      case "already_member":
        return (
          <Pressable
            style={[styles.actionButton, { backgroundColor: primaryColor + "20" }]}
            onPress={(e) => { e.stopPropagation(); handlePress(); }}
          >
            <Text style={[styles.actionButtonText, { color: primaryColor }]}>Open</Text>
          </Pressable>
        );

      case "eligible":
        if (isJoining) {
          return <ActivityIndicator size="small" color={primaryColor} />;
        }
        if (channelData.joinMode === "open") {
          return (
            <Pressable
              style={[styles.actionButton, { backgroundColor: primaryColor + "20" }]}
              onPress={(e) => { e.stopPropagation(); handleJoin(); }}
            >
              <Text style={[styles.actionButtonText, { color: primaryColor }]}>Join</Text>
            </Pressable>
          );
        }
        // approval_required
        return (
          <Pressable
            style={[styles.actionButton, { backgroundColor: primaryColor + "20" }]}
            onPress={(e) => { e.stopPropagation(); handleJoin(); }}
          >
            <Text style={[styles.actionButtonText, { color: primaryColor }]}>Request</Text>
          </Pressable>
        );

      case "pending_request":
        return (
          <View style={[styles.badge, { backgroundColor: '#FFF3E0' }]}>
            <Text style={styles.badgeText}>Pending</Text>
          </View>
        );

      default:
        return <Ionicons name="chevron-forward" size={16} color="#999" />;
    }
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.skeleton}>
          <View style={styles.skeletonIcon} />
          <View style={styles.skeletonText} />
        </View>
      </View>
    );
  }

  // Error — hide card
  if (error || !channelData) {
    return null;
  }

  return (
    <Pressable style={styles.container} onPress={handlePress}>
      <View style={styles.content}>
        {/* Left: channel icon in a colored circle */}
        <View style={[styles.iconCircle, { backgroundColor: primaryColor + "20" }]}>
          <Ionicons name="chatbubble" size={14} color={primaryColor} />
        </View>

        {/* Center: channel name + group name */}
        <View style={styles.textContainer}>
          <Text style={styles.channelName} numberOfLines={1}>
            #{channelData.channelName}
          </Text>
          <Text style={styles.groupName} numberOfLines={1}>
            {channelData.groupName}
          </Text>
        </View>

        {/* Right: action based on status */}
        {renderAction()}
      </View>
    </Pressable>
  );
}

// Match ToolLinkCard sizing for consistency
const CARD_WIDTH = Dimensions.get('window').width * 0.7;

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F7FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E0ECFA',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  channelName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  groupName: {
    fontSize: 12,
    color: '#777',
    marginTop: 1,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9500',
  },
  // Skeleton
  skeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skeletonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E5E5',
    marginRight: 10,
  },
  skeletonText: {
    height: 14,
    width: 140,
    borderRadius: 4,
    backgroundColor: '#E5E5E5',
  },
});
