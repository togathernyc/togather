/**
 * KingdomCityMigrationNotice
 *
 * The KingdomCity community is moving its groups off Togather. Anyone whose
 * active community is KingdomCity gets a bottom sheet pointing them to
 * kingdomcity.com/connect to join their new group.
 *
 * - "Join new groups" opens the site but leaves the sheet up, so people can
 *   come back to it.
 * - "Got it" or the X dismisses it for good, per person per device
 *   (AsyncStorage). A second device shows it once more there.
 * - It waits while BirthdayCollectionModal is up, so two modals never stack.
 *
 * Mounted once in the root layout, next to the other app-wide modals.
 *
 * TODO: Delete this component (and its mount in app/_layout.tsx) once the
 * KingdomCity migration is finished.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

export const KINGDOMCITY_CONNECT_URL = 'https://kingdomcity.com/connect';

/** Routes where the user is between communities, not inside KingdomCity. */
const HIDDEN_ON_ROUTES = ['/select-community'];

/**
 * Community IDs differ per environment and the client only knows the active
 * community's id and name, so match on the name ("KingdomCity",
 * "Kingdom City NYC", …), ignoring case, spaces and punctuation.
 */
export function isKingdomCityCommunity(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith('kingdomcity');
}

export function dismissedStorageKey(userId: string, communityId: string): string {
  return `kingdomcity-migration-notice-dismissed:${userId}:${communityId}`;
}

export function KingdomCityMigrationNotice() {
  const { user, community, isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const [visible, setVisible] = useState(false);

  const userId = user?.id ? String(user.id) : null;
  const communityId = community?.id ? String(community.id) : null;
  // Wait for BirthdayCollectionModal (shown while date_of_birth is missing).
  const eligible =
    isAuthenticated &&
    !isLoading &&
    !!userId &&
    !!communityId &&
    !!user?.date_of_birth &&
    isKingdomCityCommunity(community?.name);
  const storageKey = eligible ? dismissedStorageKey(userId!, communityId!) : null;

  useEffect(() => {
    if (!storageKey) {
      setVisible(false);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((dismissed) => {
        if (!cancelled) setVisible(dismissed !== '1');
      })
      .catch(() => {
        // Storage unavailable: show it; worst case it shows again next launch.
        if (!cancelled) setVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const dismiss = () => {
    setVisible(false);
    if (storageKey) AsyncStorage.setItem(storageKey, '1').catch(() => {});
  };

  const openConnect = () => {
    Linking.openURL(KINGDOMCITY_CONNECT_URL).catch(() => {});
  };

  if (!visible || HIDDEN_ON_ROUTES.some((route) => pathname?.startsWith(route))) {
    return null;
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.modalBackground, paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.closeRow}>
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={8}
              style={[styles.closeButton, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.illustration} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.tile, { backgroundColor: primaryColor }]}>
              <Text style={styles.tileText}>KC</Text>
            </View>
            <View style={[styles.arrow, { backgroundColor: primaryColor, borderColor: colors.modalBackground }]}>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </View>
            <View style={[styles.tile, { backgroundColor: accentLight }]}>
              <Ionicons name="people-outline" size={28} color={primaryColor} />
            </View>
          </View>

          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            KingdomCity is moving
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            We're bringing our groups together on a new platform. To stay connected, head to
            KingdomCity Connect and join your new group there.
          </Text>

          <Pressable
            onPress={openConnect}
            accessibilityRole="link"
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: primaryColor, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryButtonText}>Join new groups</Text>
            <Ionicons name="open-outline" size={17} color="#FFFFFF" />
          </Pressable>
          <Text style={[styles.urlCaption, { color: colors.textTertiary }]}>kingdomcity.com/connect</Text>

          <Pressable onPress={dismiss} accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: 4,
  },
  closeRow: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    marginHorizontal: -6,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  urlCaption: {
    marginTop: 10,
    fontSize: 13,
  },
  secondaryButton: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
