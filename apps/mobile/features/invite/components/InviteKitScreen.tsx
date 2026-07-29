/**
 * InviteKitScreen — "Invite your church"
 *
 * Member/admin-facing Invite Kit, adapted from the migration-wizard invite
 * kit concept (docs/plans/church-migration-ui-redesign/README.md §6, W11
 * step 4) into a standalone screen any member can reach from their profile
 * menu, rather than an admin-only wizard step. Gated behind the
 * whatsapp-shell flag end-to-end (see ProfileMenu.tsx and
 * `app/(user)/invite.tsx`'s defense-in-depth redirect) — because this screen
 * only ever mounts flag-on, it's styled unconditionally to
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` §3.2
 * (inset-grouped) / §8's "Invite kit" checklist row using the
 * `components/wa/*` kit: `bg.grouped` canvas, `WaInsetGroup`/`WaCell` cards,
 * accent-colored action rows (§1.3 "action-sheet-style green text rows").
 *
 * Three sections, each its own `WaInsetGroup` card:
 *  - Community: a QR code (on a pure-white tile — QR scanners need strong
 *    light/dark contrast, so this is one of two spots in the app that
 *    intentionally never themes to `bg.card`, see `QrCode.tsx`'s own
 *    comment) + the public URL, with copy/share as accent action cells.
 *  - Send in WhatsApp: the prewritten handoff message rendered as a
 *    footer-style quoted block (§2 footer typography + §5 reply-quote-bar
 *    visual language: left accent border, recessed tint), with copy/share
 *    as accent action cells.
 *  - Group links: short links for groups the caller leads, as `WaCell`s
 *    with a trailing copy-icon accessory (`DOMAIN_CONFIG.groupShareUrl`,
 *    same helper `GroupOptionsModal`'s "Share Group" action uses).
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
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
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { QrCode } from '@components/ui/QrCode';
import { waAccentPalette } from '@utils/waPalette';
import {
  WaInsetGroup,
  WaCell,
  WA_GROUP_SPACING,
  WA_CELL_PADDING,
  WA_REPLY_QUOTE_BORDER_WIDTH,
} from '@components/wa';
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
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;

  // §1.2 dark-mode accent shift — never reuse the light-mode brand hex
  // verbatim in dark mode (this screen's own accent-dependent rendering, see
  // restyle report's "accent consumption" finding for the *other* WA-shell
  // surfaces that skip this step).
  const accent = useMemo(
    () => waAccentPalette(primaryColor, isDark).accent,
    [primaryColor, isDark]
  );

  const communityUrl =
    community?.subdomain ? DOMAIN_CONFIG.communityUrl(community.subdomain) : null;
  const communityName = community?.name || 'Our church';

  // Copy per the brief's Rule 3: the handoff message says the community-scope
  // pitch explicitly ("your church gets its own app").
  const whatsappMessage = communityUrl
    ? `Hi everyone! \u{1F44B} ${communityName} is moving to Togather — our church gets its own app: same groups, plus events & RSVPs, with none of the other-group noise. Join here: ${communityUrl}. Sign in with your phone number and you're in.`
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
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', `${label} copied to clipboard.`);
    } catch {
      Alert.alert('Copy failed', 'Please try again.');
    }
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
        { paddingTop: insets.top, backgroundColor: colors.backgroundGrouped },
      ]}
    >
      <View style={[styles.header, { backgroundColor: colors.navBarBackground, borderBottomColor: colors.separator }]}>
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

      <ScrollView
        style={{ backgroundColor: colors.backgroundGrouped }}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.waSection}>
          {/* separatorInset=0: none of this card's rows have a leading icon
              column, so the default icon-aligned inset (§3.2's
              WA_CELL_PADDING + WA_CELL_ICON_COLUMN) would misalign hairlines
              against this card's flush-left text — same reasoning
              GroupInfoScreen's icon-less cards use (see its "Settings"/
              bottom-red-rows WaInsetGroups). */}
          <WaInsetGroup header="Community" separatorInset={0}>
            {communityUrl ? (
              <>
                {/* QR + URL caption are one visual unit — a single
                    WaInsetGroup child so no hairline splits them; the
                    separator (auto-inserted by WaInsetGroup) lands between
                    this unit and "Copy link" instead. QR must stay on pure
                    white regardless of theme/dark-mode — same contrast
                    rationale as QrCode.tsx's own comment: a themed/dark tile
                    could drop scanner contrast below what finder patterns
                    need. */}
                <View>
                  <View style={styles.qrTile}>
                    <QrCode value={communityUrl} size={180} />
                  </View>
                  <View style={styles.urlRow}>
                    <Text style={[styles.urlText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {communityUrl}
                    </Text>
                  </View>
                </View>
                <WaCell
                  variant="action"
                  title="Copy link"
                  accent={accent}
                  onPress={() => handleCopy(communityUrl, 'Link')}
                />
                <WaCell
                  variant="action"
                  title="Share"
                  accent={accent}
                  onPress={() => handleShare(`${communityName}\n${communityUrl}`, communityUrl)}
                />
              </>
            ) : (
              <EmptyCellText>
                This community doesn't have a public link set up yet.
              </EmptyCellText>
            )}
          </WaInsetGroup>
        </View>

        <View style={styles.waSection}>
          <WaInsetGroup header="Send in WhatsApp" separatorInset={0}>
            {whatsappMessage ? (
              <>
                <View
                  style={[
                    styles.quoteBlock,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                      borderLeftColor: accent,
                    },
                  ]}
                >
                  <Text style={[styles.quoteText, { color: colors.textTertiary }]}>
                    {whatsappMessage}
                  </Text>
                </View>
                <WaCell
                  variant="action"
                  title="Copy message"
                  accent={accent}
                  onPress={() => handleCopy(whatsappMessage, 'Message')}
                />
                <WaCell
                  variant="action"
                  title="Share"
                  accent={accent}
                  onPress={() => handleShare(whatsappMessage)}
                />
              </>
            ) : (
              <EmptyCellText>
                This community doesn't have a public link set up yet.
              </EmptyCellText>
            )}
          </WaInsetGroup>
        </View>

        <View style={styles.waSection}>
          <WaInsetGroup header="Group links" separatorInset={0}>
            {isLoadingGroups ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : leaderGroups.length === 0 ? (
              <EmptyCellText>
                You don't lead any groups with a shareable link yet.
              </EmptyCellText>
            ) : (
              leaderGroups.map((group) => {
                const groupUrl = DOMAIN_CONFIG.groupShareUrl(group.shortId!);
                return (
                  <WaCell
                    key={group.id}
                    title={group.name}
                    description={groupUrl}
                    trailingAccessory={
                      <Pressable
                        onPress={() => handleCopy(groupUrl, `${group.name} link`)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Copy ${group.name} link`}
                      >
                        <Ionicons name="copy-outline" size={20} color={colors.icon} />
                      </Pressable>
                    }
                  />
                );
              })
            )}
          </WaInsetGroup>
        </View>
      </ScrollView>
    </View>
  );
}

/** Plain centered helper text sized to sit inside a `WaInsetGroup` card as its only row (no cell chrome needed for a one-off empty state). */
function EmptyCellText({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{children}</Text>
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
    paddingBottom: 40,
  },
  waSection: {
    marginTop: WA_GROUP_SPACING,
  },
  qrTile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    // Intentionally hardcoded, not `colors.surfaceGrouped` — the QR tile
    // must render on pure white in both light and dark mode (see file
    // header + `QrCode.tsx`'s own comment on scanner contrast).
    backgroundColor: '#FFFFFF',
  },
  urlRow: {
    paddingHorizontal: WA_CELL_PADDING,
    paddingTop: 12,
    paddingBottom: 4,
  },
  urlText: {
    fontSize: 13,
    textAlign: 'center',
  },
  quoteBlock: {
    marginHorizontal: WA_CELL_PADDING,
    marginTop: WA_CELL_PADDING,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: WA_REPLY_QUOTE_BORDER_WIDTH,
    borderRadius: 6,
  },
  quoteText: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: WA_CELL_PADDING,
  },
  loadingRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
