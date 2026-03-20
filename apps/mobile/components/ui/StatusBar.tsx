/**
 * StatusBar - Animated bottom status bar for connection and OTA update state
 *
 * Displays a prioritized status overlay at the bottom of the screen:
 * - Connection issues take highest priority (disconnected > no internet > slow > reconnecting > reconnected)
 * - OTA update states shown when connection is healthy (checking > error)
 * - Hidden when everything is nominal (connected + OTA idle)
 *
 * Note: OTA "downloading" and "ready" states are handled by OTAUpdateModal instead.
 *
 * The bar sits at the very bottom of the screen, filling through the safe area.
 * The tab bar uses useStatusBarVisible() to add extra padding when the bar is shown,
 * keeping tab icons and labels above the banner.
 */
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useConnectionStatus } from '@providers/ConnectionProvider';
import { useOTAUpdateStatus } from '@providers/OTAUpdateProvider';

/** Height of the status bar content area (excluding safe area padding) */
export const STATUS_BAR_CONTENT_HEIGHT = 24;

interface StatusConfig {
  backgroundColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}

/**
 * Determine the active status bar config based on priority.
 * Lower priority number = higher importance.
 */
function getActiveConfig(
  connectionStatus: {
    status: string;
    isNetworkAvailable: boolean;
    isInternetReachable: boolean;
  },
  otaStatus: { status: string },
  themeColors: { error: string; warning: string; success: string; textTertiary: string },
): StatusConfig | null {
  // Cold start grace period: suppress all banners while connecting
  // NetInfo may briefly report isInternetReachable: false during initialization
  if (connectionStatus.status === 'connecting') {
    return null;
  }

  // Priority 1: Disconnected
  if (connectionStatus.status === 'disconnected') {
    return {
      backgroundColor: themeColors.error,
      icon: 'cloud-offline-outline',
      text: 'No internet connection',
    };
  }

  // Priority 2: Network available but internet not reachable
  if (connectionStatus.isNetworkAvailable && !connectionStatus.isInternetReachable) {
    return {
      backgroundColor: themeColors.error,
      icon: 'cloud-offline-outline',
      text: 'No internet',
    };
  }

  // Priority 3: Slow connection
  if (connectionStatus.status === 'slow') {
    return {
      backgroundColor: themeColors.warning,
      icon: 'cellular-outline',
      text: 'Slow connection',
    };
  }

  // Priority 4: Reconnecting
  if (connectionStatus.status === 'reconnecting') {
    return {
      backgroundColor: themeColors.warning,
      icon: 'sync-outline',
      text: 'Reconnecting...',
    };
  }

  // Priority 5: Reconnected (auto-dismisses via provider transitioning to connected)
  if (connectionStatus.status === 'reconnected') {
    return {
      backgroundColor: themeColors.success,
      icon: 'checkmark-circle-outline',
      text: 'Connected',
    };
  }

  // Priority 6: OTA checking
  if (otaStatus.status === 'checking') {
    return {
      backgroundColor: themeColors.textTertiary,
      icon: 'refresh-outline',
      text: 'Checking for updates...',
    };
  }

  // Priority 7: OTA error (auto-dismisses via provider transitioning to idle)
  if (otaStatus.status === 'error') {
    return {
      backgroundColor: themeColors.textTertiary,
      icon: 'alert-circle-outline',
      text: "Couldn't check for updates",
    };
  }

  // No active status — hide the bar
  return null;
}

/**
 * Hook for other components (e.g. tab bar) to know when the status bar is visible.
 * Returns true when a status banner is showing at the bottom of the screen.
 */
export function useStatusBarVisible(): boolean {
  const connectionStatus = useConnectionStatus();
  const otaStatus = useOTAUpdateStatus();
  const { colors } = useTheme();
  return getActiveConfig(connectionStatus, otaStatus, colors) !== null;
}

export function StatusBar() {
  const connectionStatus = useConnectionStatus();
  const otaStatus = useOTAUpdateStatus();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const config = getActiveConfig(connectionStatus, otaStatus, colors);

  // Remember the last visible config so the slide-out animation
  // retains the correct colors instead of flashing to a fallback
  const lastConfigRef = React.useRef(config);
  if (config) {
    lastConfigRef.current = config;
  }
  const displayConfig = config ?? lastConfigRef.current;

  const totalHeight = STATUS_BAR_CONTENT_HEIGHT + insets.bottom;

  // Animate: translateY from totalHeight (hidden below) to 0 (visible)
  const translateY = useSharedValue(totalHeight);

  React.useEffect(() => {
    translateY.value = withTiming(config ? 0 : totalHeight, { duration: 300 });
  }, [config, translateY, totalHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      testID="status-bar"
      style={[
        styles.overlay,
        {
          paddingBottom: insets.bottom,
          height: totalHeight,
        },
        { backgroundColor: displayConfig?.backgroundColor ?? colors.error },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <View style={styles.content}>
        {displayConfig && (
          <>
            <Ionicons
              name={displayConfig.icon}
              size={16}
              color="#fff"
              style={styles.icon}
            />
            <Text style={styles.text}>{displayConfig.text}</Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
