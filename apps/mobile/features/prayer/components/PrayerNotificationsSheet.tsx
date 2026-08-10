/**
 * PrayerNotificationsSheet — per-type prayer notification toggles.
 *
 * Surfaced from Settings → Notifications → "Prayer notifications" row.
 * The prayer page itself uses a simpler bell icon + confirmation popup for
 * the master kill switch (the most common action); this sheet is for users
 * who want fine-grained control per notification type.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from '@services/api/convex';
import type { Id } from '@services/api/convex';

type ToggleKey =
  | 'prayedFor'
  | 'update'
  | 'praiseReport'
  | 'dailyDigest'
  | 'mondayNudge'
  | 'updateNudge';

type ToggleRow = {
  key: ToggleKey;
  label: string;
  description: string;
};

const ROWS: ToggleRow[] = [
  {
    key: 'prayedFor',
    label: 'Someone prayed for you',
    description: 'When another member finishes praying for your request.',
  },
  {
    key: 'update',
    label: 'Prayer updates',
    description: "Updates from someone whose prayer you've prayed for.",
  },
  {
    key: 'praiseReport',
    label: 'Praise reports',
    description: 'When a prayer you prayed for is marked answered.',
  },
  {
    key: 'dailyDigest',
    label: 'Daily community digest',
    description: 'A daily summary of new prayer requests in your community.',
  },
  {
    key: 'mondayNudge',
    label: 'Monday morning reminders',
    description: 'A start-of-week nudge to share a prayer request.',
  },
  {
    key: 'updateNudge',
    label: 'Update reminders for your prayers',
    description: 'A nudge ~2 weeks after posting to share an update.',
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  communityId: Id<'communities'>;
}

export function PrayerNotificationsSheet({ visible, onClose, communityId }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const prefs = useAuthenticatedQuery(
    api.functions.prayers.notifications.getPrayerNotificationPreferences,
    visible ? { communityId } : 'skip',
  );
  const setMaster = useAuthenticatedMutation(
    api.functions.prayers.notifications.setMasterPrayerNotifications,
  );
  const setToggle = useAuthenticatedMutation(
    api.functions.prayers.notifications.setPrayerNotificationToggle,
  );

  const masterEnabled = prefs?.masterEnabled ?? true;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Text style={[styles.title, { color: colors.text }]}>Prayer notifications</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={colors.iconSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>
                Prayer notifications
              </Text>
              <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
                When off, you won't receive any prayer-related notifications.
              </Text>
            </View>
            <Switch
              value={masterEnabled}
              onValueChange={(value) => {
                void setMaster({ communityId, enabled: value });
              }}
              trackColor={{ false: colors.border, true: primaryColor }}
              thumbColor={colors.textInverse}
            />
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Choose specific notifications
          </Text>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0 }]}>
            {ROWS.map((row, i) => {
              const value = (prefs?.[row.key] ?? true) as boolean;
              const isLast = i === ROWS.length - 1;
              return (
                <View
                  key={row.key}
                  style={[
                    styles.toggleRow,
                    !isLast && { borderBottomColor: colors.borderLight, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text
                      style={[
                        styles.rowLabel,
                        { color: masterEnabled ? colors.text : colors.textTertiary },
                      ]}
                    >
                      {row.label}
                    </Text>
                    <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
                      {row.description}
                    </Text>
                  </View>
                  <Switch
                    value={masterEnabled && value}
                    disabled={!masterEnabled}
                    onValueChange={(next) => {
                      void setToggle({
                        communityId,
                        toggle: row.key,
                        enabled: next,
                      });
                    }}
                    trackColor={{ false: colors.border, true: primaryColor }}
                    thumbColor={colors.textInverse}
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 16, fontWeight: '600' },
  rowDescription: { fontSize: 13, marginTop: 2, lineHeight: 18 },
});
