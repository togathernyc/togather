import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';

// "Broadside" — brutalist editorial · hazard orange on paperwhite
const C = {
  bg: '#F2F2EE',
  paper: '#FFFFFF',
  ink: '#0A0A0A',
  inkSoft: '#1F1F1F',
  subtle: '#4A4A4A',
  faint: '#8C8C8C',
  rule: '#0A0A0A',
  ruleSoft: 'rgba(10,10,10,0.12)',
  accent: '#FF5A1F',
  accentSoft: '#FFE8DC',
  unreadBg: '#FFF1E9',
  unreadBgSub: '#FFE0CF',
};

const F = {
  display: '"Archivo Black", "Archivo", system-ui, sans-serif',
  sans: '"Archivo", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Archivo+Black&family=JetBrains+Mono:wght@400;600&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: '#0A0A0A', color: '#FF5A1F' },
  Teams: { bg: '#FF5A1F', color: '#0A0A0A' },
  Classes: { bg: '#FFE8DC', color: '#0A0A0A' },
};

type Channel = { _id: string; slug: string; channelType: 'main' | 'leaders' | string; name: string; lastMessagePreview: string | null; lastSender: string | null; lastWhen: string | null; unreadCount: number; };
type Group = { _id: string; name: string; image: string; groupTypeName: string; userRole: 'leader' | 'member'; channels: Channel[]; };

const groups: Group[] = [
  { _id: 'ya', name: 'Young Adults', image: 'https://picsum.photos/seed/togather-ya/200/200', groupTypeName: 'Small Groups', userRole: 'member',
    channels: [{ _id: 'ya-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya', lastWhen: '9m', unreadCount: 3 }] },
  { _id: 'sg', name: 'Small Group Alpha', image: 'https://picsum.photos/seed/togather-sg/200/200', groupTypeName: 'Small Groups', userRole: 'member',
    channels: [{ _id: 'sg-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Cornbread is covered.', lastSender: 'Ruth', lastWhen: '1h', unreadCount: 0 }] },
  { _id: 'wt', name: 'Worship Team', image: 'https://picsum.photos/seed/togather-wt/200/200', groupTypeName: 'Teams', userRole: 'leader',
    channels: [
      { _id: 'wt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Saturday 10am sharp.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 0 },
      { _id: 'wt-l', slug: 'leaders', channelType: 'leaders', name: 'Leaders', lastMessagePreview: 'Setlist draft attached.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 1 },
    ] },
  { _id: 'tt', name: 'Tech Team', image: 'https://picsum.photos/seed/togather-tt/200/200', groupTypeName: 'Teams', userRole: 'member',
    channels: [{ _id: 'tt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Projector keys, vestibule.', lastSender: 'James', lastWhen: 'Tue', unreadCount: 0 }] },
  { _id: 'nm', name: 'New Members Class', image: 'https://picsum.photos/seed/togather-nm/200/200', groupTypeName: 'Classes', userRole: 'leader',
    channels: [{ _id: 'nm-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Four RSVPs for Sunday.', lastSender: 'Dorothy', lastWhen: 'Sun', unreadCount: 0 }] },
];

const tabs = [
  { label: 'Explore', icon: 'compass' as const },
  { label: 'Inbox', icon: 'inbox' as const, active: true },
  { label: 'Admin', icon: 'shield' as const },
  { label: 'Profile', icon: 'user' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 14 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: C.ink }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: C.accent, borderWidth: 2, borderColor: C.paper,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="shield" size={11} color={C.ink} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.ink, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, fontWeight: '700', color: scheme.color, letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? C.bg : C.paper, borderBottomWidth: 2, borderBottomColor: C.ink }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 18, paddingVertical: 14,
        backgroundColor: hasUnread ? C.unreadBg : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 17, color: C.ink, letterSpacing: -0.5, flex: 1, textTransform: 'uppercase' }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13, flex: 1, marginRight: 8, fontWeight: '500',
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
            }}>{messagePreview(mainChannel)}</Text>
            {mainChannel.lastWhen && (
              <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: mainChannel.unreadCount > 0 ? C.accent : C.subtle, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 26, height: 26, backgroundColor: C.accent, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 10 }}>
            <Text style={{ fontFamily: F.display, fontSize: 13, color: C.ink }}>{totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18, backgroundColor: hasUnread ? C.unreadBg : 'transparent' }}>
            <View style={{ width: 44 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 2, height: 22, backgroundColor: C.ink }} />
              <View style={{ position: 'absolute', left: 28, top: 22, width: 14, height: 2, backgroundColor: C.ink }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 18, marginBottom: 10, marginTop: 4,
              backgroundColor: chHasUnread ? C.unreadBgSub : C.paper,
              borderWidth: 2, borderColor: C.ink,
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 12, color: C.ink, marginRight: 8, textTransform: 'uppercase' }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: chHasUnread ? C.ink : C.subtle, fontWeight: chHasUnread ? '600' : '500' }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.mono, fontSize: 10, marginLeft: 8, color: chHasUnread ? C.accent : C.subtle, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{ minWidth: 22, height: 22, backgroundColor: C.accent, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.display, color: C.ink, fontSize: 11 }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design17() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center' }}>
      <View style={{ width: '100%' as any, maxWidth: 540, flex: 1, backgroundColor: C.paper, borderLeftWidth: 2, borderRightWidth: 2, borderColor: C.ink }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 3, borderBottomColor: C.ink }}>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -1 }}>INBOX</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          {groups.map((g) => <GroupRow key={g._id} g={g} />)}
        </ScrollView>
        <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: C.ink, borderTopWidth: 3, borderTopColor: C.ink }}>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{
              flex: 1, paddingVertical: 12, paddingBottom: 22, alignItems: 'center', gap: 4,
              borderRightWidth: i < tabs.length - 1 ? 1 : 0, borderRightColor: 'rgba(255,255,255,0.12)',
              backgroundColor: t.active ? C.accent : C.ink,
            }}>
              <Feather name={t.icon} size={19} color={t.active ? C.ink : C.paper} />
              <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: t.active ? C.ink : C.paper, letterSpacing: 1.5, fontWeight: '700' }}>{t.label.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function Desktop() {
  const activeGroup = groups[0];
  const activeChannel = activeGroup.channels[0];
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg, minHeight: '100%' as any }}>
      <View style={{ width: 96, backgroundColor: C.ink, paddingTop: 24 }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            paddingVertical: 22, paddingHorizontal: 10, alignItems: 'center', gap: 6,
            borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)',
            backgroundColor: t.active ? C.accent : 'transparent',
          }}>
            <Feather name={t.icon} size={22} color={t.active ? C.ink : C.paper} />
            <Text style={{ fontFamily: F.display, fontSize: 11, color: t.active ? C.ink : C.paper, letterSpacing: 0.5 }}>{t.label.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderRightWidth: 2, borderRightColor: C.ink }}>
        <View style={{ padding: 22, paddingTop: 28, borderBottomWidth: 3, borderBottomColor: C.ink }}>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -1 }}>INBOX</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View style={{ padding: 22, borderBottomWidth: 3, borderBottomColor: C.ink, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 48, height: 48, borderWidth: 2, borderColor: C.ink }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.display, fontSize: 20, color: C.ink, letterSpacing: -0.6, textTransform: 'uppercase' }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.subtle, marginTop: 4, letterSpacing: 1.5, fontWeight: '600' }}>17 MEMBERS · 11 ONLINE</Text>
          </View>
          <Pressable style={{ width: 40, height: 40, borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="more-horizontal" size={18} color={C.ink} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: C.ink }}>
          {[{ l: 'GENERAL', active: true }, { l: 'LEADERS' }].map((t, i) => (
            <Pressable key={i} style={{
              paddingVertical: 12, paddingHorizontal: 22,
              borderRightWidth: 2, borderRightColor: C.ink,
              backgroundColor: t.active ? C.ink : C.paper,
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 13, color: t.active ? C.accent : C.ink, letterSpacing: 0.5 }}>{t.l}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row' }}>
            {[
              { l: 'ATTENDANCE', v: '23', i: 'check-square' as const },
              { l: 'PEOPLE', v: '17', i: 'users' as const },
              { l: 'EVENTS', v: '3', i: 'calendar' as const },
              { l: 'BOTS', v: null as any, i: 'cpu' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderLeftWidth: 2, borderLeftColor: C.ink }}>
                <Feather name={s.i} size={13} color={C.ink} />
                <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.ink, letterSpacing: 1.5, fontWeight: '700' }}>{s.l}</Text>
                {s.v && <View style={{ backgroundColor: C.accent, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.ink, fontWeight: '700' }}>{s.v}</Text>
                </View>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Feather name="inbox" size={48} color={C.accent} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.6, marginBottom: 8, textTransform: 'uppercase' }}>No messages yet</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center', fontWeight: '500' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ borderTopWidth: 3, borderTopColor: C.ink, flexDirection: 'row', alignItems: 'stretch' }}>
          <Pressable style={{ width: 54, borderRightWidth: 2, borderRightColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="plus" size={20} color={C.ink} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 16, justifyContent: 'center' }}>
            <TextInput
              placeholder={`MESSAGE ${activeChannel.name.toUpperCase()}…`}
              placeholderTextColor={C.faint}
              style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, fontWeight: '600', letterSpacing: 0.3, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ flexDirection: 'row', paddingHorizontal: 22, alignItems: 'center', gap: 10, backgroundColor: C.accent }}>
            <Text style={{ fontFamily: F.display, fontSize: 13, color: C.ink, letterSpacing: 1 }}>SEND</Text>
            <Feather name="arrow-up-right" size={16} color={C.ink} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
