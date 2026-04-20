import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Ledger" — tactile paper · dashed dividers · coral ink
const C = {
  bg: '#F1E8D9',
  paper: '#FAF3E5',
  paperHi: '#FFFAEF',
  surfaceHi: '#F2E9D6',
  ink: '#241A12',
  subtle: '#6E5E4E',
  faint: '#A89A86',
  rule: 'rgba(36,26,18,0.12)',
  ruleSoft: 'rgba(36,26,18,0.06)',
  accent: '#D85C3E',
  accentInk: '#8C2E18',
  accentSoft: 'rgba(216,92,62,0.10)',
  accentSub: 'rgba(216,92,62,0.16)',
  accentBorder: 'rgba(216,92,62,0.35)',
  avatarBg: '#E6DCC6',
};

const F = {
  serif: '"Source Serif 4", Georgia, serif',
  sans: '"Manrope", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;0,8..60,700;1,8..60,500&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76, 175, 80, 0.12)', color: '#3F8E46' },
  Teams: { bg: 'rgba(10, 132, 255, 0.12)', color: '#2469B0' },
  Classes: { bg: 'rgba(216, 92, 62, 0.14)', color: '#8C2E18' },
};

type Channel = { _id: string; channelType: string; name: string; lastMessagePreview: string | null; lastSender: string | null; lastWhen: string | null; unreadCount: number };
type Group = { _id: string; name: string; image: string; groupTypeName: string; userRole: 'leader' | 'member'; channels: Channel[] };

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
  { label: 'Inbox', icon: 'mail-outline' as const, activeIcon: 'mail' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: C.ink, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' }}>
        <Image source={{ uri: g.image }} style={{ width: 53, height: 53, borderRadius: 26.5 }} />
      </View>
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color={C.paper} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, fontWeight: '600', color: s.color, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function preview(ch: Channel) {
  if (!ch.lastMessagePreview) return 'No messages yet';
  if (ch.lastSender) return `${ch.lastSender}: ${ch.lastMessagePreview}`;
  return ch.lastMessagePreview;
}

function GroupRow({ g, active }: { g: Group; active?: boolean }) {
  const totalUnread = g.channels.reduce((s, c) => s + c.unreadCount, 0);
  const main = g.channels.find((c) => c.channelType === 'main') || g.channels[0];
  const isMulti = g.channels.length > 1;
  const secondary = g.channels.filter((c) => c._id !== main._id && c.unreadCount > 0);
  const hasUnread = totalUnread > 0;

  return (
    <View style={{
      backgroundColor: active ? C.surfaceHi : 'transparent',
      borderBottomWidth: 1, borderBottomStyle: 'dashed' as any, borderBottomColor: C.rule,
    }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 14,
        backgroundColor: hasUnread ? C.accentSoft : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 17, fontWeight: hasUnread ? '700' : '600', color: C.ink, flex: 1, marginRight: 8, letterSpacing: -0.3 }}>{g.name}</Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.serif, fontSize: 14, flex: 1, marginRight: 8,
              color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: main.unreadCount > 0 ? C.accent : C.faint, fontWeight: main.unreadCount > 0 ? '700' : '500', letterSpacing: 0.8 }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderWidth: 1.5, borderColor: C.accent, backgroundColor: C.paperHi, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, fontWeight: '700' }}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chUn = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 20 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.rule }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.rule }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 20, marginBottom: 8, marginTop: 4,
              backgroundColor: chUn ? C.accentSub : C.paperHi,
              borderWidth: 1, borderStyle: 'dashed' as any, borderColor: chUn ? C.accentBorder : C.rule,
            }}>
              <Text style={{ fontFamily: F.serif, fontSize: 13.5, fontWeight: chUn ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.serif, flex: 1, fontSize: 13, color: chUn ? C.ink : C.subtle, fontWeight: chUn ? '500' : '400' }}>{preview(ch)}</Text>
              {ch.lastWhen && <Text style={{ fontFamily: F.mono, fontSize: 10, marginLeft: 8, color: chUn ? C.accent : C.faint, fontWeight: chUn ? '700' : '500', letterSpacing: 0.8 }}>{ch.lastWhen}</Text>}
              {chUn && (
                <View style={{ minWidth: 22, height: 20, paddingHorizontal: 5, borderWidth: 1.5, borderColor: C.accent, backgroundColor: C.paperHi, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.accent, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design15() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 14 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '600', letterSpacing: -0.8 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: C.paperHi, paddingVertical: 10, paddingBottom: 22, borderTopWidth: 1, borderTopColor: C.ink }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accent : C.subtle} />
            <Text style={{ fontFamily: F.serif, fontSize: 11, fontStyle: t.active ? 'italic' : 'normal', color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
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
      <View style={{ width: 96, paddingTop: 34, alignItems: 'center', gap: 6, borderRightWidth: 1, borderRightColor: C.rule, backgroundColor: C.paperHi }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 70, paddingVertical: 14, alignItems: 'center', gap: 5, borderLeftWidth: 2, borderLeftColor: t.active ? C.accent : 'transparent' }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={19} color={t.active ? C.ink : C.subtle} />
            <Text style={{ fontFamily: F.serif, fontStyle: t.active ? 'italic' : 'normal', fontSize: 12, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderRightWidth: 1, borderRightColor: C.rule }}>
        <View style={{ paddingHorizontal: 26, paddingTop: 36, paddingBottom: 16 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '600', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <View style={{ height: 1, backgroundColor: C.rule, marginHorizontal: 22 }} />
        <View style={{ height: 1, backgroundColor: C.rule, marginHorizontal: 22, marginTop: 3 }} />
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.paperHi }}>
        <View style={{ padding: 32, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.rule, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}>
            <Image source={{ uri: activeGroup.image }} style={{ width: 45, height: 45, borderRadius: 22.5 }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, fontWeight: '600', letterSpacing: -0.5 }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 13, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={16} color={C.subtle} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 32, paddingTop: 14, paddingBottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 16, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.accent : 'transparent' }}>
              <Text style={{ fontFamily: F.serif, fontSize: 15, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500', fontStyle: t.active ? 'normal' : 'italic' }}>{t.l}</Text>
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
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: C.rule, borderRadius: 4, backgroundColor: C.paper }}>
                <Ionicons name={s.i} size={13} color={C.accentInk} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="mail-outline" size={48} color={C.accent} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.serif, fontSize: 26, color: C.ink, fontWeight: '600', marginBottom: 8, letterSpacing: -0.6 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 15, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: C.rule, backgroundColor: C.paper, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Pressable style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: C.rule, backgroundColor: C.paperHi, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="attach-outline" size={18} color={C.subtle} />
          </Pressable>
          <View style={{ flex: 1, borderBottomWidth: 1, borderBottomColor: C.ink, paddingHorizontal: 2, paddingVertical: 10 }}>
            <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ fontFamily: F.serif, fontSize: 15, color: C.ink, outlineWidth: 0 as any }} />
          </View>
          <Pressable style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={18} color={C.paper} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
