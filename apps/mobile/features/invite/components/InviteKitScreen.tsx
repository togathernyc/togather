/**
 * InviteKitScreen — "Invite your church"
 *
 * Member/admin-facing Invite Kit, adapted from the migration-wizard invite
 * kit concept (docs/plans/church-migration-ui-redesign/README.md §6, W11
 * step 4) into a standalone screen any member can reach from their profile
 * menu, rather than an admin-only wizard step. Gated behind the
 * whatsapp-shell flag end-to-end (see ProfileMenu.tsx).
 *
 * Three sections:
 *  - Community: QR code + copy/share for the community's public URL
 *    (`DOMAIN_CONFIG.communityUrl`, the same subdomain entry point the app
 *    already routes through at sign-in — see `useCommunitySubdomain`).
 *  - Send in WhatsApp: a prewritten handoff message with copy/share, so an
 *    admin can paste it straight into their existing WhatsApp group.
 *  - Group links: short links for groups the caller leads, using the same
 *    `DOMAIN_CONFIG.groupShareUrl` helper as `GroupOptionsModal`'s
 *    "Share Group" action.
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { DOMAIN_CONFIG } from '@togather/shared';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { Card } from '@components/ui/Card';
import { QrCode } from '@components/ui/QrCode';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

interface LeaderGroup {
  id: string;
  name: string;
  shortId?: string;
}

export function InviteKitScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;

  const communityUrl =
    community?.subdomain ? DOMAIN_CONFIG.communityUrl(community.subdomain) : null;
  const communityName = community?.name || 'Our church';

  const whatsappMessage = communityUrl
    ? `Hi everyone! \u{1F44B} ${communityName} is moving to Togather — same groups, plus events & RSVPs. Join here: ${communityUrl}. Sign in with your phone number and you're in.`
    : null;

  const myGroups = useAuthenticatedQuery(
    api.functions.groups.queries.listForUser,
    communityId ? { communityId } : 'skip'
  );
  const isLoadingGroups = myGroups === undefined;

  const leaderGroups: LeaderGroup[] = useMemo(() => {
    if (!myGroups) return [];
    return myGroups
      .filter((g: any) => g.userRole === 'leader' && !!g.shortId)
      .map((g: any) => ({ id: String(g._id), name: g.name, shortId: g.shortId }));
  }, [myGroups]);

  const handleCopy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  };

  const handleShare = async (message: string, url?: string) => {
    try {
      await Share.share(url ? { message, url } : { message });
    } catch {
      // User cancelled the share sheet — nothing to do.
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.backgroundSecondary },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Invite your church</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          COMMUNITY
        </Text>
        <Card style={styles.card}>
          {communityUrl ? (
            <>
              <View style={styles.qrWrap}>
                <QrCode value={communityUrl} size={180} />
              </View>
              <Text style={[styles.urlText, { color: colors.textSecondary }]} numberOfLines={1}>
                {communityUrl}
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={() => handleCopy(communityUrl, 'Link')}
                >
                  <Ionicons name="copy-outline" size={18} color={colors.text} />
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    Copy link
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={() =>
                    handleShare(`${communityName}\n${communityUrl}`, communityUrl)
                  }
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    Share
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              This community doesn't have a public link set up yet.
            </Text>
          )}
        </Card>

        <Text
          style={[styles.sectionLabel, styles.sectionLabelSpaced, { color: colors.textSecondary }]}
        >
          SEND IN WHATSAPP
        </Text>
        <Card style={styles.card}>
          {whatsappMessage ? (
            <>
              <Text style={[styles.messageText, { color: colors.text }]}>
                {whatsappMessage}
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={() => handleCopy(whatsappMessage, 'Message')}
                >
                  <Ionicons name="copy-outline" size={18} color={colors.text} />
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    Copy message
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                  onPress={() => handleShare(whatsappMessage)}
                >
                  <Ionicons name="share-outline" size={18} color={colors.text} />
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    Share
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              This community doesn't have a public link set up yet.
            </Text>
          )}
        </Card>

        <Text
          style={[styles.sectionLabel, styles.sectionLabelSpaced, { color: colors.textSecondary }]}
        >
          GROUP LINKS
        </Text>
        <Card style={styles.card}>
          {isLoadingGroups ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : leaderGroups.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              You don't lead any groups with a shareable link yet.
            </Text>
          ) : (
            leaderGroups.map((group, index) => {
              const groupUrl = DOMAIN_CONFIG.groupShareUrl(group.shortId!);
              return (
                <View
                  key={group.id}
                  style={[
                    styles.groupRow,
                    index < leaderGroups.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.groupTextContainer}>
                    <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Text
                      style={[styles.groupUrl, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {groupUrl}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.copyIconButton}
                    onPress={() => handleCopy(groupUrl, `${group.name} link`)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="copy-outline" size={20} color={colors.icon} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 28,
  },
  card: {
    padding: 20,
  },
  qrWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  urlText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 8,
  },
  loadingRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  groupTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  groupName: {
    fontSize: 15,
    fontWeight: '600',
  },
  groupUrl: {
    fontSize: 13,
    marginTop: 2,
  },
  copyIconButton: {
    padding: 4,
  },
});
