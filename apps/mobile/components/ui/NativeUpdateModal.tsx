import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { DOMAIN_CONFIG } from '@togather/shared';
import { useTheme } from '@hooks/useTheme';

// Environment-aware URLs
const isStaging = Constants.expoConfig?.extra?.isStaging === true;

// R2 images bucket for release manifests
const R2_IMAGES_URL = `https://images.${DOMAIN_CONFIG.baseDomain}`;

const URLS = {
  production: {
    appStore: 'https://apps.apple.com/us/app/togather-life-in-community/id6756286011',
    androidDownload: `${DOMAIN_CONFIG.appUrl}/android`,
    // Use platform-specific manifests - iOS and Android may be at different versions
    // if one is still in review or had a failed submission
    iosManifest: `${R2_IMAGES_URL}/releases/ios/production/manifest.json`,
    androidManifest: `${R2_IMAGES_URL}/releases/android/production/manifest.json`,
  },
  staging: {
    // Staging TestFlight - users need to be invited
    appStore: 'https://testflight.apple.com/join/JNdDOp2N',
    androidDownload: `https://staging.${DOMAIN_CONFIG.baseDomain}/android`,
    iosManifest: `${R2_IMAGES_URL}/releases/ios/staging/manifest.json`,
    androidManifest: `${R2_IMAGES_URL}/releases/android/staging/manifest.json`,
  },
};

const urls = isStaging ? URLS.staging : URLS.production;

interface Manifest {
  version: string;
  releaseDate: string;
  downloadUrl: string;
  minSupportedVersion: string;
  // ISO date string - update modal only shown after this time
  // This prevents blocking users during App Store/TestFlight review period
  availableAfter?: string;
}

/**
 * Compares two semver version strings
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Modal that appears when a new native version is available.
 *
 * This modal is NOT dismissable - users must update to continue.
 *
 * Update detection:
 * 1. Fetches manifest from R2 to compare versions
 * 2. If currentVersion < latestVersion → show modal
 * 3. Also catches expo-updates ERR_NOT_COMPATIBLE errors
 *
 * The modal directs users to:
 * - iOS: App Store (production) or TestFlight (staging)
 * - Android: Download page on togather.nyc or staging.togather.nyc
 */
export function NativeUpdateModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  // Use nativeApplicationVersion (from Info.plist / build.gradle) instead of
  // Constants.expoConfig.version — the latter changes with OTA updates, so all
  // users on the same runtimeVersion would report the latest OTA version and
  // never see the force-update modal.
  const nativeVersion = Application.nativeApplicationVersion;
  const expoVersion = Constants.expoConfig?.version;
  const currentVersion = nativeVersion || expoVersion || '1.0.0';
  const isAndroid = Platform.OS === 'android';

  // Debug: log all version sources to diagnose force-update issues
  useEffect(() => {
    console.log('[NativeUpdateModal] Version sources:', {
      nativeApplicationVersion: nativeVersion,
      expoConfigVersion: expoVersion,
      resolvedCurrentVersion: currentVersion,
      runtimeVersion: Constants.expoConfig?.runtimeVersion,
      __DEV__,
    });
  }, []);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    // Skip in development
    if (__DEV__) {
      setIsChecking(false);
      return;
    }

    checkForNativeUpdate();
  }, []);

  const checkForNativeUpdate = async () => {
    setIsChecking(true);

    try {
      // Check manifest for version info (works for both iOS and Android)
      await checkManifest();

      // Also check expo-updates for incompatible updates
      // This catches cases where the fingerprint changed but version didn't bump
      try {
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          // Compatible OTA update available - let OTAUpdateGate handle it
          // No need to show native update modal
        }
      } catch (updateError: any) {
        // Check if this is a compatibility error (requires new native build)
        if (
          updateError?.code === 'ERR_NOT_COMPATIBLE' ||
          updateError?.message?.includes('not compatible')
        ) {
          console.log('[NativeUpdateModal] Native update required - incompatible update detected');
          setIsVisible(true);
        }
      }
    } catch (error) {
      console.log('[NativeUpdateModal] Error checking for native update:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const checkManifest = async () => {
    try {
      // Use platform-specific manifest URL with cache-busting to bypass CDN caching
      const manifestUrl = isAndroid ? urls.androidManifest : urls.iosManifest;
      const response = await fetch(`${manifestUrl}?t=${Date.now()}`);
      if (!response.ok) {
        console.log('[NativeUpdateModal] Failed to fetch manifest:', response.status);
        return;
      }

      const manifest: Manifest = await response.json();
      setLatestVersion(manifest.version);

      console.log(`[NativeUpdateModal] Current: ${currentVersion}, Latest: ${manifest.version}`);

      // Force update if ANY newer version is available
      const newerAvailable = compareVersions(currentVersion, manifest.version) < 0;
      if (newerAvailable) {
        // Check if update is actually available (past the availableAfter time)
        // This prevents blocking users during App Store/TestFlight review period
        if (manifest.availableAfter) {
          const availableTime = new Date(manifest.availableAfter).getTime();
          const now = Date.now();
          if (now < availableTime) {
            console.log(
              `[NativeUpdateModal] Update not yet available. Will be available at ${manifest.availableAfter}`
            );
            return;
          }
        }

        console.log('[NativeUpdateModal] Newer version available, showing update modal');
        setIsVisible(true);
      }
    } catch (error) {
      console.log('[NativeUpdateModal] Failed to check manifest:', error);
    }
  };

  const handleUpdate = () => {
    const url = isAndroid ? urls.androidDownload : urls.appStore;
    Linking.openURL(url);
  };

  // Don't render anything while checking
  if (isChecking) return null;

  // No update needed
  if (!isVisible) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      // Prevent dismissal via back button on Android
      onRequestClose={() => {}}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.modal, { backgroundColor: colors.modalBackground }]}>
          <View style={[styles.iconContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons
              name={isAndroid ? 'logo-android' : 'logo-apple'}
              size={48}
              color={isAndroid ? '#3ddc84' : colors.text}
            />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Update Required</Text>

          <Text style={[styles.message, { color: colors.textSecondary }]}>
            A new version of Togather is available. Please update to continue using the app.
          </Text>

          {latestVersion && (
            <View style={[styles.versionInfo, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.versionText, { color: colors.textTertiary }]}>
                {currentVersion} → {latestVersion}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.updateButton}
            onPress={handleUpdate}
            activeOpacity={0.8}
          >
            <Ionicons name="download-outline" size={20} color={colors.textInverse} />
            <Text style={[styles.updateButtonText, { color: colors.textInverse }]}>
              {isAndroid ? 'Download Update' : (isStaging ? 'Open TestFlight' : 'Open App Store')}
            </Text>
          </TouchableOpacity>

          {isStaging && (
            <Text style={[styles.stagingNote, { color: colors.warning }]}>
              Staging build - update via TestFlight (iOS) or direct download (Android)
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  versionInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 20,
  },
  versionText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    gap: 8,
  },
  updateButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  stagingNote: {
    marginTop: 16,
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
