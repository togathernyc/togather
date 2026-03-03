import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Pressable,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Avatar } from '@components/ui/Avatar';
import { Ionicons } from '@expo/vector-icons';

const isWeb = Platform.OS === 'web';

interface SwipeableCommunityRowProps {
  community: {
    id: number | string;
    name: string;
    logo?: string | null;
    memberCount?: number;
  };
  onPress: () => void;
  onLeavePress: () => void;
  isCurrentCommunity?: boolean;
  disabled?: boolean;
}

const BUTTON_WIDTH = 80;

export function SwipeableCommunityRow({
  community,
  onPress,
  onLeavePress,
  isCurrentCommunity = false,
  disabled = false,
}: SwipeableCommunityRowProps) {
  const translateX = useSharedValue(0);
  const isOpen = useSharedValue(false);
  const [isHovered, setIsHovered] = useState(false);

  const closeSwipe = useCallback(() => {
    translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
    isOpen.value = false;
  }, [translateX, isOpen]);

  const openSwipe = useCallback(() => {
    translateX.value = withSpring(-BUTTON_WIDTH, { damping: 20, stiffness: 200 });
    isOpen.value = true;
  }, [translateX, isOpen]);

  const handleRowPress = useCallback(() => {
    if (isOpen.value) {
      closeSwipe();
    } else {
      onPress();
    }
  }, [isOpen, closeSwipe, onPress]);

  const handleLeavePress = useCallback(() => {
    closeSwipe();
    onLeavePress();
  }, [closeSwipe, onLeavePress]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      const newValue = (isOpen.value ? -BUTTON_WIDTH : 0) + event.translationX;
      // Clamp between -BUTTON_WIDTH and 0
      translateX.value = Math.min(0, Math.max(-BUTTON_WIDTH, newValue));
    })
    .onEnd((event) => {
      const shouldOpen = translateX.value < -BUTTON_WIDTH / 2;
      if (shouldOpen) {
        runOnJS(openSwipe)();
      } else {
        runOnJS(closeSwipe)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const rowContent = (
    <View style={styles.content}>
      <Avatar
        name={community.name}
        imageUrl={community.logo ?? null}
        size={48}
        style={styles.avatar}
      />

      <View style={styles.textContainer}>
        <View style={styles.nameRow}>
          <Text style={styles.communityName} numberOfLines={1}>
            {community.name}
          </Text>
          {isCurrentCommunity && (
            <Ionicons name="checkmark-circle" size={20} color="#0A84FF" />
          )}
        </View>

        {community.memberCount !== undefined && (
          <Text style={styles.memberCount}>
            {community.memberCount === 1
              ? '1 member'
              : `${community.memberCount.toLocaleString()} members`}
          </Text>
        )}
      </View>

      {/* Show leave button on hover for web, chevron otherwise */}
      {isWeb && isHovered ? (
        <TouchableOpacity
          style={styles.webLeaveButton}
          onPress={(e) => {
            e.stopPropagation();
            onLeavePress();
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="exit-outline" size={16} color="#FF3B30" />
          <Text style={styles.webLeaveButtonText}>Leave</Text>
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
      )}
    </View>
  );

  // Web version: use hover to reveal leave button
  if (isWeb) {
    return (
      <View style={styles.container}>
        <Pressable
          onPress={onPress}
          onHoverIn={() => setIsHovered(true)}
          onHoverOut={() => setIsHovered(false)}
          disabled={disabled}
          style={({ pressed }) => [
            styles.row,
            isCurrentCommunity && styles.currentCommunityRow,
            pressed && styles.rowPressed,
            disabled && styles.rowDisabled,
          ]}
        >
          {rowContent}
        </Pressable>
      </View>
    );
  }

  // Native version: swipe to reveal leave button
  return (
    <View style={styles.container}>
      {/* Hidden "Leave" button underneath */}
      <View style={styles.hiddenButtonContainer}>
        <TouchableOpacity
          style={styles.leaveButton}
          onPress={handleLeavePress}
          activeOpacity={0.7}
        >
          <Ionicons name="exit-outline" size={20} color="#fff" style={styles.leaveIcon} />
          <Text style={styles.leaveButtonText}>Leave</Text>
        </TouchableOpacity>
      </View>

      {/* Swipeable row content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.rowWrapper, animatedStyle]}>
          <Pressable
            onPress={handleRowPress}
            disabled={disabled}
            style={({ pressed }) => [
              styles.row,
              isCurrentCommunity && styles.currentCommunityRow,
              pressed && styles.rowPressed,
              disabled && styles.rowDisabled,
            ]}
          >
            {rowContent}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
  },
  hiddenButtonContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: BUTTON_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  leaveButton: {
    width: BUTTON_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveIcon: {
    marginBottom: 2,
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  rowWrapper: {
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  row: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  currentCommunityRow: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  communityName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222224',
    flex: 1,
  },
  memberCount: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  webLeaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
    gap: 4,
  },
  webLeaveButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
});
