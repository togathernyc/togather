/**
 * ConservatoryInbox — production inbox rendered in the Conservatory design.
 * Extracted from app/design-28.tsx. Consumes DesignGroup[] via inboxDesignAdapter.
 *
 * Identity: pastel base + frosted-glass cards + Literata serif + teal accent +
 * decorative pastel circles in the background.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppImage } from '@components/ui';
import { conservatoryColors as C } from '@/theme/palettes/conservatoryColors';
import { conservatoryFonts as F } from '@/theme/fonts';
import type { DesignChannel, DesignGroup } from '../../utils/inboxDesignAdapter';
import type { InboxDesignProps } from './types';

const TINT_1 = '#F3E9D2';
const TINT_2 = '#D0DAE4';
const TINT_3 = '#E9D5D9';
const GLASS_HI = 'rgba(255,255,255,0.78)';
const GLASS_DIM = 'rgba(255,255,255,0.32)';
const UNREAD_BG = 'rgba(28,107,94,0.08)';
const UNREAD_BG_SUB = 'rgba(28,107,94,0.12)';
const UNREAD_BORDER = 'rgba(28,107,94,0.35)';

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76, 175, 80, 0.1)', color: '#4CAF50' },
  Teams: { bg: 'rgba(10, 132, 255, 0.1)', color: '#0A84FF' },
  Classes: { bg: 'rgba(255, 149, 0, 0.1)', color: '#FF9500' },
};

function Backdrop() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' } as any}>
      <View style={{ position: 'absolute', width: 520, height: 520, borderRadius: 260, backgroundColor: TINT_1, top: -120, left: -140, opacity: 0.75 }} />
      <View style={{ position: 'absolute', width: 640, height: 640, borderRadius: 320, backgroundColor: TINT_2, bottom: -220, right: -200, opacity: 0.85 }} />
      <View style={{ position: 'absolute', width: 380, height: 380, borderRadius: 190, backgroundColor: TINT_3, top: '35%', left: '40%', opacity: 0.5 } as any} />
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.selectedBackground, color: C.link };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.body, fontSize: 11, fontWeight: '600', color: s.color }}>{label}</Text>
    </View>
  );
}

function Avatar({ g, size = 56 }: { g: DesignGroup; size?: number }) {
  const badge = Math.round(size * 0.36);
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.6)' }}>
        <AppImage
          source={g.image}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          optimizedWidth={120}
          placeholder={{ type: 'initials', name: g.name, backgroundColor: 'rgba(255,255,255,0.6)' }}
        />
      </View>
      {g.userRole === 'leader' && (
        <View
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: badge, height: badge, borderRadius: badge / 2,
            backgroundColor: C.link, borderWidth: 2, borderColor: '#fff',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="shield" size={Math.round(badge * 0.6)} color="#fff" />
        </View>
      )}
    </View>
  );
}

function preview(ch: DesignChannel) {
  if (!ch.lastMessagePreview) return 'No messages yet';
  if (ch.lastSender) return `${ch.lastSender}: ${ch.lastMessagePreview}`;
  return ch.lastMessagePreview;
}

function GroupRow({
  g,
  isActive,
  activeChannelSlug,
  onGroupPress,
  onChannelPress,
}: {
  g: DesignGroup;
  isActive: boolean;
  activeChannelSlug?: string;
  onGroupPress: (groupId: string) => void;
  onChannelPress: (groupId: string, channelSlug: string) => void;
}) {
  const totalUnread = g.channels.reduce((s, c) => s + c.unreadCount, 0);
  const main = g.channels.find((c) => c.channelType === 'main') || g.channels[0];
  const isMulti = g.channels.length > 1;
  const secondary = g.channels.filter((c) => c._id !== main._id && c.unreadCount > 0);
  const hasUnread = totalUnread > 0;

  return (
    <View
      style={{
        marginHorizontal: 12, marginBottom: 8, borderRadius: 20,
        backgroundColor: isActive ? GLASS_HI : hasUnread ? UNREAD_BG : GLASS_DIM,
        borderWidth: 1,
        borderColor: isActive ? 'rgba(255,255,255,0.9)' : C.borderLight,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => onGroupPress(g._id)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 }}
      >
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 19, color: C.text, letterSpacing: -0.3, flex: 1, marginRight: 8 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: F.body, fontSize: 13, flex: 1, marginRight: 8,
                color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.text : C.textSecondary,
                fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
              }}
            >
              {preview(main)}
            </Text>
            {main.lastWhen && (
              <Text
                style={{
                  fontFamily: F.body, fontSize: 11,
                  color: main.unreadCount > 0 ? C.link : C.textTertiary,
                  fontWeight: main.unreadCount > 0 ? '600' : '500',
                }}
              >
                {main.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View
            style={{
              minWidth: 22, height: 22, borderRadius: 11,
              backgroundColor: C.link, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 6, marginLeft: 8,
            }}
          >
            <Text style={{ fontFamily: F.body, color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        const channelActive = activeChannelSlug === ch.slug && isActive;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 14 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.border }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.border }} />
            </View>
            <Pressable
              onPress={() => onChannelPress(g._id, ch.slug)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
                marginRight: 14, marginBottom: 10, marginTop: 4,
                borderWidth: 1,
                backgroundColor: channelActive ? GLASS_HI : chHasUnread ? UNREAD_BG_SUB : GLASS_DIM,
                borderColor: chHasUnread ? UNREAD_BORDER : C.borderLight,
              }}
            >
              <Text style={{ fontFamily: F.body, fontSize: 12.5, fontWeight: chHasUnread ? '700' : '600', color: C.text, marginRight: 8 }}>
                {ch.name}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: F.body, flex: 1, fontSize: 12.5,
                  color: chHasUnread ? C.text : C.textSecondary,
                  fontWeight: chHasUnread ? '500' : '400',
                }}
              >
                {preview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text
                  style={{
                    fontFamily: F.body, fontSize: 11, marginLeft: 8,
                    color: chHasUnread ? C.link : C.textTertiary,
                    fontWeight: chHasUnread ? '600' : '500',
                  }}
                >
                  {ch.lastWhen}
                </Text>
              )}
              {chHasUnread && (
                <View
                  style={{
                    minWidth: 20, height: 20, borderRadius: 10,
                    backgroundColor: C.link, alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 5, marginLeft: 8,
                  }}
                >
                  <Text style={{ fontFamily: F.body, color: '#fff', fontSize: 11, fontWeight: '700' }}>
                    {ch.unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function LoadingState() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator size="small" color={C.link} />
    </View>
  );
}

function EmptyState() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <View
        style={{
          width: 96, height: 96, borderRadius: 48,
          backgroundColor: GLASS_HI, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
          alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}
      >
        <Ionicons name="leaf-outline" size={36} color={C.link} />
      </View>
      <Text style={{ fontFamily: F.display, fontSize: 22, color: C.text, fontWeight: '700', marginBottom: 6, letterSpacing: -0.4 }}>
        Quiet here
      </Text>
      <Text style={{ fontFamily: F.body, fontSize: 13, color: C.textSecondary, textAlign: 'center' }}>
        Join a group to begin a conversation.
      </Text>
    </View>
  );
}

export function ConservatoryInbox({
  items,
  loading,
  sidebarMode,
  activeGroupId,
  activeChannelSlug,
  onGroupPress,
  onChannelPress,
}: InboxDesignProps) {
  const content = loading
    ? <LoadingState />
    : items.length === 0
    ? <EmptyState />
    : items.map((g) => (
        <GroupRow
          key={g._id}
          g={g}
          isActive={activeGroupId === g._id}
          activeChannelSlug={activeChannelSlug}
          onGroupPress={onGroupPress}
          onChannelPress={onChannelPress}
        />
      ));

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <Backdrop />
      {!sidebarMode && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }}>
          <Text style={{ fontFamily: F.display, fontSize: 28, fontWeight: '700', color: C.text, letterSpacing: -0.5 }}>
            Inbox
          </Text>
        </View>
      )}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: sidebarMode ? 24 : 32, flexGrow: items.length === 0 && !loading ? 1 : undefined }}
      >
        {content}
      </ScrollView>
    </View>
  );
}
