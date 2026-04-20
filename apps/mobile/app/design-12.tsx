import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Blush" — soft pastel · rounded · coral-on-rose
const C = {
  bg: '#FBEFE7',
  card: '#FFF8F2',
  cardHi: '#FFFFFF',
  surfaceActive: '#FBDCCF',
  ink: '#2B1F1A',
  subtle: '#7A6A62',
  faint: '#B3A59B',
  line: 'rgba(43,31,26,0.08)',
  accent: '#E87A5D',
  accentInk: '#AC3E22',
  accentSoft: 'rgba(232,122,93,0.10)',
  accentSub: '#FBDCCF',
  accentBorder: 'rgba(232,122,93,0.35)',
  avatarBg: '#F2E0D3',
};

const F = {
  sans: '"Plus Jakarta Sans", system-ui, sans-serif',
  serif: '"Fraunces", Georgia, serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(143, 169, 139, 0.18)', color: '#5F7D5C' },
  Teams: { bg: 'rgba(156, 139, 169, 0.18)', color: '#6F5A82' },
  Classes: { bg: 'rgba(232, 122, 93, 0.16)', color: '#AC3E22' },
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
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.avatarBg }} />
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, borderWidth: 2, borderColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 11, fontWeight: '700', color: s.color }}>{label}</Text>
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
    <View>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 12,
        marginHorizontal: 10, marginVertical: 4,
        borderRadius: 20,
        backgroundColor: active ? C.surfaceActive : hasUnread ? C.accentSoft : C.cardHi,
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.sans, fontSize: 15.5, fontWeight: '700', color: C.ink, flex: 1, marginRight: 8 }}>{g.name}</Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13.5, flex: 1, marginRight: 8,
              color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 11.5, color: main.unreadCount > 0 ? C.accentInk : C.faint, fontWeight: main.unreadCount > 0 ? '700' : '500' }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
            <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 11, fontWeight: '700' }}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chUn = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 20 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 18, backgroundColor: C.line }} />
              <View style={{ position: 'absolute', left: 28, top: 18, width: 12, height: 1.5, backgroundColor: C.line }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 20, marginBottom: 6, marginTop: 2,
              backgroundColor: chUn ? C.accentSub : C.card,
              borderWidth: 1, borderColor: chUn ? C.accentBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.sans, fontSize: 13, fontWeight: chUn ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.sans, flex: 1, fontSize: 13, color: chUn ? C.ink : C.subtle, fontWeight: chUn ? '500' : '400' }}>{preview(ch)}</Text>
              {ch.lastWhen && <Text style={{ fontFamily: F.sans, fontSize: 11, marginLeft: 8, color: chUn ? C.accentInk : C.faint, fontWeight: chUn ? '700' : '500' }}>{ch.lastWhen}</Text>}
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

export default function Design12() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 32, color: C.ink, fontWeight: '600', letterSpacing: -1 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110, paddingTop: 4 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{ position: 'absolute' as any, bottom: 14, left: 14, right: 14, flexDirection: 'row', padding: 8, borderRadius: 28, backgroundColor: C.cardHi, shadowColor: '#8A4A33', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 20, backgroundColor: t.active ? C.accentSub : 'transparent', gap: 2 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accentInk : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.accentInk : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
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
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg, padding: 18, gap: 18 }}>
      <View style={{ width: 96, paddingTop: 24, alignItems: 'center', gap: 10 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 20, color: '#fff', fontWeight: '600', fontStyle: 'italic' }}>t</Text>
        </View>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 72, paddingVertical: 12, borderRadius: 18, alignItems: 'center', gap: 4, backgroundColor: t.active ? C.cardHi : 'transparent' }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accentInk : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10.5, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.card, borderRadius: 32, paddingTop: 24, paddingBottom: 12 }}>
        <View style={{ paddingHorizontal: 22, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: C.ink, fontWeight: '600', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 32, overflow: 'hidden' }}>
        <View style={{ padding: 24, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.avatarBg }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, fontWeight: '600', letterSpacing: -0.5 }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={C.subtle} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 4 }}>
            {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
              <Pressable key={i} style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8, backgroundColor: t.active ? C.cardHi : 'transparent' }}>
                <Text style={{ fontFamily: F.sans, fontSize: 13, color: t.active ? C.ink : C.subtle, fontWeight: '600' }}>{t.l}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4 }}>
            {[
              { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const },
              { l: 'People', v: '17', i: 'people-outline' as const },
              { l: 'Events', v: '3', i: 'calendar-outline' as const },
              { l: 'Bots', v: null, i: 'hardware-chip-outline' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.cardHi }}>
                <Ionicons name={s.i} size={13} color={C.accentInk} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: C.accentSub, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={36} color={C.accent} />
          </View>
          <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.ink, fontWeight: '600', marginBottom: 8, letterSpacing: -0.6 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 18, paddingTop: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.cardHi, borderRadius: 24, paddingLeft: 8, paddingRight: 8, paddingVertical: 8 }}>
            <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color={C.subtle} />
            </Pressable>
            <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any, paddingVertical: 6 }} />
            <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
