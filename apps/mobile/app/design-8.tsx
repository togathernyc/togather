import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "iMessage" — clean white, rounded, restrained · terracotta accent
const C = {
  bg: '#FFFFFF',
  surface: '#F2F2F4',
  surfaceHi: '#ECECEE',
  ink: '#0E0E0F',
  subtle: '#6C6C70',
  faint: '#AEAEB2',
  divider: 'rgba(0,0,0,0.06)',
  accent: '#B85C38',
  accentSoft: 'rgba(184,92,56,0.08)',
  accentSub: 'rgba(184,92,56,0.14)',
  accentBorder: 'rgba(184,92,56,0.28)',
  avatarBg: '#E5E5E5',
};

const F = {
  sans: '"Manrope", system-ui, sans-serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const gradients = [
  { from: '#F3B48A', to: '#B85C38' },
  { from: '#BFD3A0', to: '#7A9554' },
  { from: '#C9B1E4', to: '#8670B8' },
  { from: '#A9C7E0', to: '#5A7FA3' },
  { from: '#F0C987', to: '#B89554' },
];

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76, 175, 80, 0.1)', color: '#4CAF50' },
  Teams: { bg: 'rgba(10, 132, 255, 0.1)', color: '#0A84FF' },
  Classes: { bg: 'rgba(255, 149, 0, 0.1)', color: '#FF9500' },
};

type Channel = {
  _id: string;
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
  { _id: 'ya', name: 'Young Adults', image: 'https://picsum.photos/seed/togather-ya/200/200', groupTypeName: 'Small Groups', userRole: 'member',
    channels: [{ _id: 'ya-m', channelType: 'main', name: 'General', lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya', lastWhen: '9m', unreadCount: 3 }] },
  { _id: 'sg', name: 'Small Group Alpha', image: 'https://picsum.photos/seed/togather-sg/200/200', groupTypeName: 'Small Groups', userRole: 'member',
    channels: [{ _id: 'sg-m', channelType: 'main', name: 'General', lastMessagePreview: 'Cornbread is covered.', lastSender: 'Ruth', lastWhen: '1h', unreadCount: 0 }] },
  { _id: 'wt', name: 'Worship Team', image: 'https://picsum.photos/seed/togather-wt/200/200', groupTypeName: 'Teams', userRole: 'leader',
    channels: [
      { _id: 'wt-m', channelType: 'main', name: 'General', lastMessagePreview: 'Saturday 10am sharp.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 0 },
      { _id: 'wt-l', channelType: 'leaders', name: 'Leaders', lastMessagePreview: 'Setlist draft attached.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 1 },
    ] },
  { _id: 'tt', name: 'Tech Team', image: 'https://picsum.photos/seed/togather-tt/200/200', groupTypeName: 'Teams', userRole: 'member',
    channels: [{ _id: 'tt-m', channelType: 'main', name: 'General', lastMessagePreview: 'Projector keys, vestibule.', lastSender: 'James', lastWhen: 'Tue', unreadCount: 0 }] },
  { _id: 'nm', name: 'New Members Class', image: 'https://picsum.photos/seed/togather-nm/200/200', groupTypeName: 'Classes', userRole: 'leader',
    channels: [{ _id: 'nm-m', channelType: 'main', name: 'General', lastMessagePreview: 'Four RSVPs for Sunday.', lastSender: 'Dorothy', lastWhen: 'Sun', unreadCount: 0 }] },
];

const tabs = [
  { label: 'Explore', icon: 'compass-outline' as const, activeIcon: 'compass' as const },
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Avatar({ g, i }: { g: Group; i: number }) {
  const gr = gradients[i % gradients.length];
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28,
        // @ts-expect-error - RN web style
        backgroundImage: `linear-gradient(135deg, ${gr.from}, ${gr.to})`,
        backgroundColor: gr.to,
        overflow: 'hidden',
      }}>
        <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      </View>
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 11, fontWeight: '600', color: s.color }}>{label}</Text>
    </View>
  );
}

function preview(ch: Channel) {
  if (!ch.lastMessagePreview) return 'No messages yet';
  if (ch.lastSender) return `${ch.lastSender}: ${ch.lastMessagePreview}`;
  return ch.lastMessagePreview;
}

function GroupRow({ g, i, active }: { g: Group; i: number; active?: boolean }) {
  const totalUnread = g.channels.reduce((s, c) => s + c.unreadCount, 0);
  const main = g.channels.find((c) => c.channelType === 'main') || g.channels[0];
  const isMulti = g.channels.length > 1;
  const secondary = g.channels.filter((c) => c._id !== main._id && c.unreadCount > 0);
  const hasUnread = totalUnread > 0;

  return (
    <View style={{ backgroundColor: active ? C.surface : 'transparent' }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: hasUnread ? C.accentSoft : 'transparent',
      }}>
        <Avatar g={g} i={i} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.sans, fontSize: 16, fontWeight: hasUnread ? '700' : '600', color: C.ink, flex: 1, marginRight: 8 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 14, flex: 1, marginRight: 8,
              color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
            }}>
              {preview(main)}
            </Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: main.unreadCount > 0 ? C.accent : C.faint, fontWeight: main.unreadCount > 0 ? '600' : '500' }}>
                {main.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
            <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 12, fontWeight: '700' }}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chUn = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 16 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.divider }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.divider }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 16, marginBottom: 8, marginTop: 4,
              backgroundColor: chUn ? C.accentSub : C.surface,
              borderWidth: 1, borderColor: chUn ? C.accentBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.sans, fontSize: 13, fontWeight: chUn ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.sans, flex: 1, fontSize: 13, color: chUn ? C.ink : C.subtle, fontWeight: chUn ? '500' : '400' }}>
                {preview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.sans, fontSize: 11, marginLeft: 8, color: chUn ? C.accent : C.faint, fontWeight: chUn ? '600' : '500' }}>{ch.lastWhen}</Text>
              )}
              {chUn && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 11, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design8() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 28, color: C.ink, fontWeight: '800', letterSpacing: -0.8 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8, paddingBottom: 100 }}>
        {groups.map((g, i) => <GroupRow key={g._id} g={g} i={i} />)}
      </ScrollView>
      <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingVertical: 8, paddingBottom: 22, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.divider }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 2, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={24} color={t.active ? C.accent : C.faint} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.accent : C.faint, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Desktop() {
  const activeGroup = groups[0];
  const activeChannel = activeGroup.channels[0];

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: 72, backgroundColor: C.surface, alignItems: 'center', paddingTop: 26, gap: 6 }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 56, paddingVertical: 10, borderRadius: 14, alignItems: 'center', gap: 4, backgroundColor: t.active ? C.bg : 'transparent' }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.accent : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.accent : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 380, borderRightWidth: 1, borderRightColor: C.divider }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 28, color: C.ink, fontWeight: '800', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} i={i} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 28, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.divider, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.avatarBg }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: F.sans, fontSize: 16, color: C.ink, fontWeight: '700' }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={C.subtle} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 28, paddingTop: 12, gap: 20, borderBottomWidth: 1, borderBottomColor: C.divider, alignItems: 'flex-end' }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.accent : 'transparent' }}>
              <Text style={{ fontFamily: F.sans, fontSize: 14, fontWeight: t.active ? '700' : '500', color: t.active ? C.ink : C.subtle }}>{t.l}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const },
              { l: 'People', v: '17', i: 'people-outline' as const },
              { l: 'Events', v: '3', i: 'calendar-outline' as const },
              { l: 'Bots', v: null, i: 'hardware-chip-outline' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.surface }}>
                <Ionicons name={s.i} size={13} color={C.subtle} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={48} color={C.accent} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.sans, fontSize: 20, color: C.ink, fontWeight: '700', marginBottom: 8 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 15, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: C.divider, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={22} color={C.subtle} />
          </Pressable>
          <View style={{ flex: 1, borderRadius: 22, borderWidth: 1, borderColor: C.divider, paddingHorizontal: 16, height: 38, justifyContent: 'center' }}>
            <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any }} />
          </View>
          <Pressable style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
