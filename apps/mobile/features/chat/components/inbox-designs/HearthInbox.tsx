/**
 * HearthInbox — production inbox rendered in the Hearth design.
 * Extracted from app/design-14.tsx. Consumes DesignGroup[] via inboxDesignAdapter.
 *
 * Palette + fonts come from the Hearth theme directly (not useTheme), so this
 * component looks correct regardless of which preference is active. That lets
 * it be snapshot-tested without a provider.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppImage } from '@components/ui';
import { hearthColors as C } from '@/theme/palettes/hearthColors';
import { hearthFonts as F } from '@/theme/fonts';
import type { DesignChannel, DesignGroup } from '../../utils/inboxDesignAdapter';
import type { InboxDesignProps } from './types';

// Group-type badge colors (match design-14 swatches).
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(135, 200, 120, 0.14)', color: '#9AD38A' },
  Teams: { bg: 'rgba(140, 185, 240, 0.14)', color: '#A6C5EE' },
  Classes: { bg: 'rgba(230, 122, 60, 0.16)', color: '#F7A06B' },
};

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.selectedBackground, color: C.link };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.body, fontSize: 11, fontWeight: '600', color: s.color }}>{label}</Text>
    </View>
  );
}

function Avatar({ g }: { g: DesignGroup }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View
        style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: C.surfaceSecondary, borderWidth: 1, borderColor: C.border,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}
      >
        <AppImage
          source={g.image}
          style={{ width: 54, height: 54, borderRadius: 27 }}
          optimizedWidth={120}
          placeholder={{ type: 'initials', name: g.name, backgroundColor: C.surfaceSecondary }}
        />
      </View>
      {g.userRole === 'leader' && (
        <View
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 20, height: 20, borderRadius: 10,
            backgroundColor: C.link, borderWidth: 2, borderColor: C.background,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="shield" size={11} color={C.background} />
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
    <View>
      <Pressable
        onPress={() => onGroupPress(g._id)}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingVertical: 12,
          marginHorizontal: 10, marginVertical: 3,
          borderRadius: 16,
          backgroundColor: isActive ? C.surfaceSecondary : hasUnread ? 'rgba(230,122,60,0.14)' : 'transparent',
          ...(isActive
            ? { shadowColor: C.link, shadowOpacity: 0.25, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } }
            : {}),
        }}
      >
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: F.display, fontSize: 16, fontWeight: hasUnread ? '700' : '600',
                color: C.text, flex: 1, marginRight: 8, letterSpacing: -0.3,
              }}
            >
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: F.body, fontSize: 13.5, flex: 1, marginRight: 8,
                color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.text : C.textSecondary,
                fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
              }}
            >
              {preview(main)}
            </Text>
            {main.lastWhen && (
              <Text
                style={{
                  fontFamily: F.body, fontSize: 11.5,
                  color: main.unreadCount > 0 ? '#F7A06B' : C.textTertiary,
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
            <Text style={{ fontFamily: F.body, color: C.background, fontSize: 11, fontWeight: '700' }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chUn = ch.unreadCount > 0;
        const channelActive = activeChannelSlug === ch.slug && isActive;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 20 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 18, backgroundColor: C.border }} />
              <View style={{ position: 'absolute', left: 28, top: 18, width: 12, height: 1.5, backgroundColor: C.border }} />
            </View>
            <Pressable
              onPress={() => onChannelPress(g._id, ch.slug)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
                marginRight: 20, marginBottom: 6, marginTop: 2,
                backgroundColor: channelActive ? C.surfaceSecondary : chUn ? 'rgba(230,122,60,0.22)' : C.surface,
                borderWidth: 1,
                borderColor: chUn ? 'rgba(230,122,60,0.40)' : 'transparent',
              }}
            >
              <Text style={{ fontFamily: F.display, fontSize: 13.5, fontWeight: chUn ? '700' : '600', color: C.text, marginRight: 8 }}>
                {ch.name}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: F.body, flex: 1, fontSize: 13,
                  color: chUn ? C.text : C.textSecondary,
                  fontWeight: chUn ? '500' : '400',
                }}
              >
                {preview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text
                  style={{
                    fontFamily: F.body, fontSize: 11, marginLeft: 8,
                    color: chUn ? '#F7A06B' : C.textTertiary,
                    fontWeight: chUn ? '600' : '500',
                  }}
                >
                  {ch.lastWhen}
                </Text>
              )}
              {chUn && (
                <View
                  style={{
                    minWidth: 20, height: 20, borderRadius: 10,
                    backgroundColor: C.link, alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 5, marginLeft: 8,
                  }}
                >
                  <Text style={{ fontFamily: F.body, color: C.background, fontSize: 11, fontWeight: '700' }}>
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
          backgroundColor: 'rgba(230,122,60,0.14)',
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.link, shadowOpacity: 0.4, shadowRadius: 40, shadowOffset: { width: 0, height: 0 },
          borderWidth: 1, borderColor: C.link, marginBottom: 20,
        }}
      >
        <MaterialCommunityIcons name="message-outline" size={40} color="#F7A06B" />
      </View>
      <Text style={{ fontFamily: F.display, fontSize: 22, color: C.text, fontWeight: '600', marginBottom: 8, letterSpacing: -0.6 }}>
        No messages yet
      </Text>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: C.textSecondary, textAlign: 'center' }}>
        Join a group to start seeing conversations here.
      </Text>
    </View>
  );
}

export function HearthInbox({
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
      {!sidebarMode && (
        <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 }}>
          <Text style={{ fontFamily: F.display, fontSize: 30, color: C.text, fontWeight: '600', letterSpacing: -0.8 }}>
            Inbox
          </Text>
        </View>
      )}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: sidebarMode ? 24 : 32, flexGrow: items.length === 0 && !loading ? 1 : undefined }}
      >
        {content}
      </ScrollView>
    </View>
  );
}
