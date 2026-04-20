/**
 * ConsoleInbox — production inbox rendered in the Console design.
 * Extracted from app/design-20.tsx. Consumes DesignGroup[] via inboxDesignAdapter.
 *
 * Identity: warm light "terminal buffer" with mono type, > prompts, #tag-style badges.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppImage } from '@components/ui';
import { consoleColors as C } from '@/theme/palettes/consoleColors';
import { consoleFonts as F } from '@/theme/fonts';
import type { DesignChannel, DesignGroup } from '../../utils/inboxDesignAdapter';
import type { InboxDesignProps } from './types';

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(91,122,62,0.12)', color: '#5B7A3E' },
  Teams: { bg: 'rgba(59,94,138,0.14)', color: '#3B5E8A' },
  Classes: { bg: 'rgba(204,122,26,0.12)', color: C.link },
};

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.selectedBackground, color: C.link };
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10.5, fontWeight: '700', color: s.color, letterSpacing: 0.3 }}>
        #{label.toLowerCase().replace(' ', '-')}
      </Text>
    </View>
  );
}

function Avatar({ g }: { g: DesignGroup }) {
  return (
    <View style={{ position: 'relative', marginRight: 14 }}>
      <View style={{ width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', backgroundColor: C.surface }}>
        <AppImage
          source={g.image}
          style={{ width: 54, height: 54 }}
          optimizedWidth={120}
          placeholder={{ type: 'initials', name: g.name, backgroundColor: C.surface }}
        />
      </View>
      {g.userRole === 'leader' && (
        <View
          style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 20, height: 20, borderRadius: 6,
            backgroundColor: C.link, borderWidth: 2, borderColor: C.surface,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="shield" size={11} color={C.surfaceSecondary} />
        </View>
      )}
    </View>
  );
}

function messagePreview(ch: DesignChannel) {
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
    <View style={{ backgroundColor: isActive ? C.selectedBackground : 'transparent', borderBottomWidth: 1, borderBottomColor: C.borderLight }}>
      <Pressable
        onPress={() => onGroupPress(g._id)}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 18, paddingVertical: 14,
          backgroundColor: hasUnread && !isActive ? C.selectedBackground : 'transparent',
        }}
      >
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 15, color: C.text, fontWeight: '600', flex: 1 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: F.mono, fontSize: 12.5, flex: 1, marginRight: 8,
                color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.text : C.textSecondary,
                fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
              }}
            >
              <Text style={{ color: C.textTertiary }}>{'> '}</Text>
              {messagePreview(main)}
            </Text>
            {main.lastWhen && (
              <Text
                style={{
                  fontFamily: F.mono, fontSize: 10.5,
                  color: main.unreadCount > 0 ? C.link : C.textTertiary,
                  fontWeight: main.unreadCount > 0 ? '700' : '500',
                  letterSpacing: 0.5,
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
              minWidth: 26, height: 22, borderRadius: 4,
              backgroundColor: C.link, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 7, marginLeft: 10,
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.surfaceSecondary, fontWeight: '700' }}>
              +{totalUnread}
            </Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        const channelActive = activeChannelSlug === ch.slug && isActive;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18 }}>
            <View style={{ width: 44 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.border }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.border }} />
            </View>
            <Pressable
              onPress={() => onChannelPress(g._id, ch.slug)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9,
                marginRight: 18, marginBottom: 10, marginTop: 4,
                backgroundColor: channelActive ? C.selectedBackground : chHasUnread ? 'rgba(204,122,26,0.20)' : C.surfaceSecondary,
                borderWidth: 1, borderColor: chHasUnread ? C.link : C.border,
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 12, fontWeight: '700', color: C.text, marginRight: 8 }}>
                #{ch.name.toLowerCase()}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1, fontFamily: F.mono, fontSize: 12,
                  color: chHasUnread ? C.text : C.textSecondary,
                  fontWeight: chHasUnread ? '500' : '400',
                }}
              >
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text
                  style={{
                    fontFamily: F.mono, fontSize: 10, marginLeft: 8,
                    color: chHasUnread ? C.link : C.textTertiary,
                    fontWeight: chHasUnread ? '700' : '500',
                  }}
                >
                  {ch.lastWhen}
                </Text>
              )}
              {chHasUnread && (
                <View
                  style={{
                    minWidth: 22, height: 18, borderRadius: 4,
                    backgroundColor: C.link, alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 5, marginLeft: 8,
                  }}
                >
                  <Text style={{ fontFamily: F.mono, color: C.surfaceSecondary, fontSize: 10, fontWeight: '700' }}>
                    +{ch.unreadCount}
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
      <Text style={{ fontFamily: F.mono, fontSize: 18, color: C.text, fontWeight: '700', marginBottom: 8 }}>
        $ inbox.list <Text style={{ color: C.link }}>--empty</Text>
      </Text>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.textSecondary, textAlign: 'center' }}>
        // no conversations yet — join a group to begin
      </Text>
    </View>
  );
}

export function ConsoleInbox({
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
      <View style={{ flex: 1, backgroundColor: C.surface }}>
        {!sidebarMode && (
          <View style={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontFamily: F.mono, fontSize: 28, color: C.text, fontWeight: '700', letterSpacing: -1 }}>
              inbox<Text style={{ color: C.link }}>_</Text>
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
    </View>
  );
}
