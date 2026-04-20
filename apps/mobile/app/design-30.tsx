import React from 'react';
import { ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Production" — matches apps/mobile/features/chat/components/ChatInboxScreen + GroupedInboxItem
// Uses placeholder images (picsum) for group avatars.

const C = {
  surface: '#FFFFFF',
  surfaceSecondary: '#F2F2F7',
  unreadBg: '#F0F7FF',
  unreadBgSub: '#EBF3FF',
  unreadBorder: '#D0E2FF',
  text: '#0A0A0A',
  textSecondary: '#6B6B6B',
  textTertiary: '#8E8E93',
  border: '#E5E5EA',
  iconSecondary: '#8E8E93',
  primary: '#2563EB',
  link: '#2563EB',
  avatarBg: '#E5E5E5',
};

// Mirrors getGroupTypeColorScheme() from constants/groupTypes.ts
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76, 175, 80, 0.1)', color: '#4CAF50' },
  Teams: { bg: 'rgba(10, 132, 255, 0.1)', color: '#0A84FF' },
  Classes: { bg: 'rgba(255, 149, 0, 0.1)', color: '#FF9500' },
};

type Channel = {
  _id: string;
  slug: string;
  channelType: 'main' | 'leaders' | string;
  name: string;
  lastMessagePreview: string | null;
  lastSender: string | null;
  lastWhen: string | null;
  unreadCount: number;
};

type Group = {
  _id: string;
  name: string;
  image: string;
  groupTypeName: string;
  userRole: 'leader' | 'member';
  channels: Channel[];
};

const groups: Group[] = [
  {
    _id: 'ya',
    name: 'Young Adults',
    image: 'https://picsum.photos/seed/togather-ya/200/200',
    groupTypeName: 'Small Groups',
    userRole: 'member',
    channels: [
      { _id: 'ya-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya', lastWhen: '9m', unreadCount: 3 },
    ],
  },
  {
    _id: 'sg',
    name: 'Small Group Alpha',
    image: 'https://picsum.photos/seed/togather-sg/200/200',
    groupTypeName: 'Small Groups',
    userRole: 'member',
    channels: [
      { _id: 'sg-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Cornbread is covered.', lastSender: 'Ruth', lastWhen: '1h', unreadCount: 0 },
    ],
  },
  {
    _id: 'wt',
    name: 'Worship Team',
    image: 'https://picsum.photos/seed/togather-wt/200/200',
    groupTypeName: 'Teams',
    userRole: 'leader',
    channels: [
      { _id: 'wt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Saturday 10am sharp.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 0 },
      { _id: 'wt-l', slug: 'leaders', channelType: 'leaders', name: 'Leaders', lastMessagePreview: 'Setlist draft attached.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 1 },
    ],
  },
  {
    _id: 'tt',
    name: 'Tech Team',
    image: 'https://picsum.photos/seed/togather-tt/200/200',
    groupTypeName: 'Teams',
    userRole: 'member',
    channels: [
      { _id: 'tt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Projector keys, vestibule.', lastSender: 'James', lastWhen: 'Tue', unreadCount: 0 },
    ],
  },
  {
    _id: 'nm',
    name: 'New Members Class',
    image: 'https://picsum.photos/seed/togather-nm/200/200',
    groupTypeName: 'Classes',
    userRole: 'leader',
    channels: [
      { _id: 'nm-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Four RSVPs for Sunday.', lastSender: 'Dorothy', lastWhen: 'Sun', unreadCount: 0 },
    ],
  },
];

const tabs = [
  { label: 'Explore', icon: 'compass-outline' as const, activeIcon: 'compass' as const },
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.avatarBg }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: C.primary, borderWidth: 2, borderColor: C.surface,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="shield" size={12} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: 'rgba(74,111,243,0.1)', color: C.primary };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: scheme.bg }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: scheme.color }}>{label}</Text>
    </View>
  );
}

function messagePreview(ch: Channel) {
  if (!ch.lastMessagePreview) return 'No messages yet';
  if (ch.lastSender) return `${ch.lastSender}: ${ch.lastMessagePreview}`;
  return ch.lastMessagePreview;
}

function GroupRow({ g, active }: { g: Group; active?: boolean }) {
  const totalUnread = g.channels.reduce((s, c) => s + c.unreadCount, 0);
  const mainChannel = g.channels.find((c) => c.channelType === 'main') || g.channels[0];
  const isMultiChannel = g.channels.length > 1;
  const secondaryChannels = g.channels.filter((c) => c._id !== mainChannel._id && c.unreadCount > 0);
  const hasUnread = totalUnread > 0;

  return (
    <View style={{ backgroundColor: active ? C.surfaceSecondary : C.surface }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: hasUnread ? C.unreadBg : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: hasUnread ? '700' : '600', color: C.text, flex: 1, marginRight: 8 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontSize: 14, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.text : C.textSecondary,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '600' : '400',
            }}>
              {messagePreview(mainChannel)}
            </Text>
            {mainChannel.lastWhen && (
              <Text style={{
                fontSize: 12,
                color: mainChannel.unreadCount > 0 ? C.link : C.textTertiary,
                fontWeight: mainChannel.unreadCount > 0 ? '600' : '400',
              }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{
            minWidth: 22, height: 22, borderRadius: 11,
            backgroundColor: C.primary,
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 6, marginLeft: 8,
          }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 16 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.border }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.border }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 16, marginBottom: 8, marginTop: 4,
              borderWidth: 1,
              backgroundColor: chHasUnread ? C.unreadBgSub : C.surfaceSecondary,
              borderColor: chHasUnread ? C.unreadBorder : 'transparent',
            }}>
              <Text style={{ fontSize: 13, fontWeight: chHasUnread ? '700' : '600', color: C.text, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{
                flex: 1, fontSize: 13,
                color: chHasUnread ? C.text : C.textSecondary,
                fontWeight: chHasUnread ? '500' : '400',
              }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{
                  fontSize: 11, marginLeft: 8,
                  color: chHasUnread ? C.link : C.textTertiary,
                  fontWeight: chHasUnread ? '600' : '400',
                }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{
                  minWidth: 20, height: 20, borderRadius: 10,
                  backgroundColor: C.primary,
                  alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 5, marginLeft: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design30() {
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.surface }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16 }}>
        <Text style={{ fontSize: 28, fontWeight: '700', color: C.text }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8, paddingBottom: 90 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{
        position: 'absolute' as any, bottom: 0, left: 0, right: 0,
        flexDirection: 'row', paddingVertical: 8, paddingBottom: 22,
        backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
      }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 2, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={24} color={t.active ? C.primary : C.iconSecondary} />
            <Text style={{ fontSize: 10, color: t.active ? C.primary : C.iconSecondary, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Desktop() {
  const activeGroup = groups[0];
  const activeChannel = activeGroup.channels[0];
  const typeColor = TYPE_COLORS[activeGroup.groupTypeName] || { bg: 'rgba(74,111,243,0.1)', color: C.primary };

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.surface }}>
      <View style={{ width: 72, borderRightWidth: 1, borderRightColor: C.border, alignItems: 'center', paddingTop: 24, gap: 4 }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 56, paddingVertical: 10, alignItems: 'center', gap: 4, borderRadius: 10 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.primary : C.iconSecondary} />
            <Text style={{ fontSize: 10, color: t.active ? C.primary : C.iconSecondary, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 380, borderRightWidth: 1, borderRightColor: C.border }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: C.text }}>Inbox</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.avatarBg }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={C.iconSecondary} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, gap: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.primary : 'transparent' }}>
              <Text style={{ fontSize: 14, fontWeight: t.active ? '700' : '500', color: t.active ? C.text : C.textSecondary }}>{t.l}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const },
              { l: 'People', v: '17', i: 'people-outline' as const },
              { l: 'Events', v: '3', i: 'calendar-outline' as const },
              { l: 'Bots', v: null, i: 'hardware-chip-outline' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.surfaceSecondary }}>
                <Ionicons name={s.i} size={13} color={C.textSecondary} />
                <Text style={{ fontSize: 12, color: C.text, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontSize: 11, color: C.primary, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={48} color={C.iconSecondary} style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 20, fontWeight: '600', color: C.text, marginBottom: 8 }}>No messages yet</Text>
          <Text style={{ fontSize: 16, color: C.textSecondary, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={24} color={C.iconSecondary} />
          </Pressable>
          <View style={{ flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 20, paddingHorizontal: 14, height: 40, justifyContent: 'center' }}>
            <TextInput
              placeholder={`Message ${activeChannel.name}`}
              placeholderTextColor={C.textTertiary}
              style={{ fontSize: 14, color: C.text, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
