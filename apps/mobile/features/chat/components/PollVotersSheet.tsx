/**
 * PollVotersSheet — modal sheet showing who voted for what on a poll.
 *
 * Sectioned by option: each section header is the option text + vote
 * count, followed by a list of voters with avatar + full display name.
 * Opened by tapping the poll card's footer.
 *
 * v1 always returns voter identities (no anonymity yet). The query
 * already gates this on `canSeeIdentities` so a future anonymous mode
 * can hide non-leader views without UI changes here.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Id } from '@services/api/convex';
import { api, useQuery, useStoredAuthToken } from '@services/api/convex';
import { Avatar } from '@components/ui';
import { useTheme } from '@hooks/useTheme';

interface VoterRow {
  userId: Id<'users'>;
  displayName: string;
  profilePhoto?: string;
  createdAt: number;
}

interface Section {
  title: string;
  count: number;
  data: VoterRow[];
}

interface PollVotersSheetProps {
  visible: boolean;
  pollId: Id<'polls'> | null;
  onClose: () => void;
}

export function PollVotersSheet({ visible, pollId, onClose }: PollVotersSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const token = useStoredAuthToken();

  const data = useQuery(
    api.functions.messaging.polls.getPollVoters,
    token && pollId && visible ? { token, pollId } : 'skip',
  );

  const sections: Section[] =
    data?.options.map((opt) => ({
      title: opt.text,
      count: opt.count,
      data: opt.voters,
    })) ?? [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Math.max(insets.top, 12),
            },
          ]}
        >
          <View style={styles.headerSpacer} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Votes</Text>
          <Pressable onPress={onClose} hitSlop={8} style={styles.headerClose}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        {data === undefined ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.link} />
          </View>
        ) : data === null ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              Couldn't load votes.
            </Text>
          </View>
        ) : data.voterCount === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              No votes yet.
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item, index) => `${item.userId}-${index}`}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              data.truncated ? (
                <View
                  style={[
                    styles.truncatedBanner,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.truncatedText, { color: colors.textSecondary }]}>
                    Showing the first voters. The list is capped for performance.
                  </Text>
                </View>
              ) : null
            }
            renderSectionHeader={({ section }) => (
              <View
                style={[
                  styles.sectionHeader,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.sectionTitle, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {section.title}
                </Text>
                <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>
                  {section.count} {section.count === 1 ? 'vote' : 'votes'}
                </Text>
              </View>
            )}
            renderItem={({ item }) => (
              <View style={styles.voterRow}>
                <Avatar
                  name={item.displayName}
                  imageUrl={item.profilePhoto}
                  size={36}
                />
                <Text
                  style={[styles.voterName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {item.displayName}
                </Text>
              </View>
            )}
            renderSectionFooter={({ section }) =>
              section.data.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={[styles.emptySectionText, { color: colors.textTertiary }]}>
                    {data.canSeeIdentities ? 'No votes' : 'Anonymous votes'}
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: {
    width: 28,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 15,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  voterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  voterName: {
    fontSize: 15,
    flex: 1,
  },
  emptySection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptySectionText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  truncatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  truncatedText: {
    fontSize: 12,
    flex: 1,
  },
});
