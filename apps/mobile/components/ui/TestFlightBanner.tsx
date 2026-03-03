import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { DOMAIN_CONFIG } from '@togather/shared';

const STORAGE_KEY = 'app_download_banner_dismissed';
const APP_STORE_URL = 'https://apps.apple.com/us/app/togather-life-in-community/id6756286011';
const ANDROID_URL = `${DOMAIN_CONFIG.appUrl}/android`;

/**
 * Checks if the current browser is on a mobile device
 */
function isMobileBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(userAgent);
}

/**
 * Checks if the current browser is on an iOS device
 */
function isIOSBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/i.test(userAgent);
}

/**
 * A dismissable banner that appears on mobile web only, prompting users to download the app.
 * On iOS, directs to App Store. On Android, directs to the APK download page.
 * Once dismissed, the banner won't appear again (persisted via localStorage).
 */
export function TestFlightBanner() {
  const { primaryColor } = useCommunityTheme();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show on mobile web
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    if (!isMobileBrowser()) {
      return;
    }

    // Check if banner was previously dismissed
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) {
        setIsVisible(true);
      }
    } catch {
      // localStorage not available, show banner anyway
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // localStorage not available, just hide for this session
    }
  };

  const isIOS = isIOSBrowser();
  const downloadUrl = isIOS ? APP_STORE_URL : ANDROID_URL;
  const bannerText = isIOS ? 'Get the app on the App Store' : 'Get the app for Android';

  const handlePress = () => {
    Linking.openURL(downloadUrl);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: primaryColor }]}>
      <Pressable style={styles.content} onPress={handlePress}>
        <Ionicons name="download-outline" size={18} color="#fff" style={styles.icon} />
        <Text style={styles.text}>
          {bannerText}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
      </Pressable>
      <Pressable
        style={styles.dismissButton}
        onPress={handleDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  dismissButton: {
    padding: 4,
    marginLeft: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
});
