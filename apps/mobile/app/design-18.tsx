import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Bauhaus" — primary geometry · brick on bone · indigo support
const C = {
  bg: '#EDE7DA',
  paper: '#F7F2E6',
  paperHi: '#FFFDF5',
  ink: '#161514',
  subtle: '#4A4742',
  faint: '#8A847A',
  rule: '#161514',
  ruleSoft: 'rgba(22,21,20,0.14)',
  accent: '#C94A2A',
  accentSoft: '#F2C8B6',
  support: '#1E2A63',
  supportSoft: 'rgba(30,42,99,0.12)',
  ochre: '#D9A441',
  ochreSoft: 'rgba(217,164,65,0.18)',
  unreadBg: 'rgba(201,74,42,0.08)',
  unreadBgSub: 'rgba(201,74,42,0.16)',
};

const F = {
  display: '"Bricolage Grotesque", system-ui, sans-serif',
  sans: '"Manrope", system-ui, sans-serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(201,74,42,0.14)', color: '#C94A2A' },
  Teams: { bg: 'rgba(30,42,99,0.14)', color: '#1E2A63' },
  Classes: { bg: 'rgba(217,164,65,0.22)', color: '#8E6716' },
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
  { label: 'Explore', icon: 'compass-outline' as const, activeIcon: 'compass' as const },
  { label: 'Inbox', icon: 'mail-outline' as const, activeIcon: 'mail' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Shape({ type, color, size = 40 }: any) {
  if (type === 'square') return <View style={{ width: size, height: size, backgroundColor: color }} />;
  if (type === 'triangle') {
    return (
      <View style={{
        width: 0, height: 0,
        borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: size * 0.88,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
      }} />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 14 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: C.ochre, borderWidth: 2, borderColor: C.paper,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="shield" size={11} color={C.ink} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.supportSoft, color: C.support };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 11, fontWeight: '700', color: scheme.color, letterSpacing: 0.5 }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? C.accentSoft : C.paper, borderBottomWidth: 1, borderBottomColor: C.ruleSoft }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 22, paddingVertical: 14,
        backgroundColor: hasUnread && !active ? C.unreadBg : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 17, color: C.ink, fontWeight: '700', letterSpacing: -0.4, flex: 1 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '600' : '500',
            }}>{messagePreview(mainChannel)}</Text>
            {mainChannel.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 11, color: mainChannel.unreadCount > 0 ? C.accent : C.faint, fontWeight: '600' }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 26, height: 26, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, marginLeft: 10 }}>
            <Text style={{ fontFamily: F.display, fontSize: 12, color: C.ochre, fontWeight: '800' }}>{totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 22 }}>
            <View style={{ width: 46 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 2, height: 22, backgroundColor: C.ink }} />
              <View style={{ position: 'absolute', left: 28, top: 22, width: 14, height: 2, backgroundColor: C.ink }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 22, marginBottom: 10, marginTop: 4,
              backgroundColor: chHasUnread ? C.unreadBgSub : C.paperHi,
              borderWidth: 1.5, borderColor: chHasUnread ? C.accent : C.ruleSoft,
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 13, fontWeight: '700', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: chHasUnread ? C.ink : C.subtle, fontWeight: chHasUnread ? '600' : '500' }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.sans, fontSize: 11, marginLeft: 8, color: chHasUnread ? C.accent : C.faint, fontWeight: '600' }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{ minWidth: 22, height: 22, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.display, color: C.ochre, fontSize: 11, fontWeight: '800' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design18() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function HeaderRow() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, fontWeight: '800', letterSpacing: -0.8 }}>Inbox</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Shape type="circle" color={C.accent} size={12} />
        <Shape type="square" color={C.support} size={12} />
        <View style={{
          width: 0, height: 0,
          borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 10,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C.ochre,
        }} />
      </View>
    </View>
  );
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center' }}>
      <View style={{ width: '100%' as any, maxWidth: 540, flex: 1, backgroundColor: C.paper }}>
        <View style={{ padding: 22, paddingTop: 56, paddingBottom: 14 }}>
          <HeaderRow />
        </View>
        <View style={{ height: 2, backgroundColor: C.ink }} />
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
          {groups.map((g) => <GroupRow key={g._id} g={g} />)}
        </ScrollView>
        <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: C.paperHi, borderTopWidth: 2, borderTopColor: C.ink, paddingVertical: 8, paddingBottom: 20 }}>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6 }}>
              <View style={{
                width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.active ? C.accent : 'transparent',
                borderRadius: t.active ? 18 : 0,
              }}>
                <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.paperHi : C.ink} />
              </View>
              <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
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
      <View style={{ width: 92, backgroundColor: C.ink, paddingTop: 24, alignItems: 'center', gap: 8 }}>
        <View style={{ marginBottom: 18, alignItems: 'center', gap: 2 }}>
          <Shape type="circle" color={C.accent} size={16} />
          <Shape type="square" color={C.ochre} size={16} />
        </View>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 70, paddingVertical: 14, alignItems: 'center', gap: 5 }}>
            <View style={{
              width: 44, height: 44, borderRadius: t.active ? 22 : 0,
              backgroundColor: t.active ? C.accent : 'transparent',
              borderWidth: t.active ? 0 : 1, borderColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.ink : C.paper} />
            </View>
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.ochre : C.paper, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderRightWidth: 2, borderRightColor: C.ink }}>
        <View style={{ padding: 22, paddingTop: 28 }}>
          <HeaderRow />
        </View>
        <View style={{ height: 2, backgroundColor: C.ink }} />
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.paperHi }}>
        <View style={{ padding: 22, borderBottomWidth: 2, borderBottomColor: C.ink, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 48, height: 48, borderRadius: 24 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.display, fontSize: 22, color: C.ink, fontWeight: '800', letterSpacing: -0.6 }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.subtle, marginTop: 4, fontWeight: '500' }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 40, height: 40, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={C.ink} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 12, gap: 0, borderBottomWidth: 1, borderBottomColor: C.ruleSoft }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <Pressable key={i} style={{ paddingVertical: 10, paddingHorizontal: 18, backgroundColor: t.active ? C.ink : 'transparent', marginRight: 4 }}>
              <Text style={{ fontFamily: F.display, fontSize: 13, color: t.active ? C.ochre : C.ink, fontWeight: '700', letterSpacing: 0.3 }}>{t.l}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const, c: C.accent },
              { l: 'People', v: '17', i: 'people-outline' as const, c: C.support },
              { l: 'Events', v: '3', i: 'calendar-outline' as const, c: C.ochre },
              { l: 'Bots', v: null as any, i: 'hardware-chip-outline' as const, c: C.subtle },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: s.c, backgroundColor: C.paperHi }}>
                <Ionicons name={s.i} size={13} color={s.c} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '700' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.display, fontSize: 12, color: s.c, fontWeight: '800' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <Shape type="circle" color={C.accent} size={28} />
            <Shape type="square" color={C.support} size={28} />
            <Shape type="triangle" color={C.ochre} size={28} />
          </View>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, fontWeight: '800', letterSpacing: -0.6, marginBottom: 8 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center', fontWeight: '500' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ borderTopWidth: 2, borderTopColor: C.ink, flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.paperHi }}>
          <Pressable style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: C.ruleSoft }}>
            <Ionicons name="add" size={22} color={C.ink} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 16, height: 52, justifyContent: 'center' }}>
            <TextInput
              placeholder={`Message ${activeChannel.name}`}
              placeholderTextColor={C.faint}
              style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any, fontWeight: '500' }}
            />
          </View>
          <Pressable style={{ height: 52, paddingHorizontal: 20, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: F.display, fontSize: 13, color: C.paperHi, fontWeight: '700', letterSpacing: 0.5 }}>Send</Text>
            <Ionicons name="arrow-forward" size={16} color={C.paperHi} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
