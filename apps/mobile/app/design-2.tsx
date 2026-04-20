import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Sunday Bulletin" — order-of-service newsprint · responsive
const C = {
  paper: '#F6F2E7',
  ink: '#0C0C0C',
  tomato: '#E24B2A',
  ash: '#5E5E5E',
  rule: '#C9C2AE',
  band: '#EDE7D3',
  unreadBg: 'rgba(226,75,42,0.08)',
  unreadBgSub: 'rgba(226,75,42,0.12)',
  unreadBorder: 'rgba(226,75,42,0.28)',
};

const F = {
  display: '"Instrument Serif", "Times New Roman", serif',
  mono: '"IBM Plex Mono", "Courier New", monospace',
  body: '"Inter Tight", system-ui, sans-serif',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(12,12,12,0.08)', color: C.ink },
  Teams: { bg: 'rgba(226,75,42,0.12)', color: C.tomato },
  Classes: { bg: 'rgba(94,94,94,0.14)', color: C.ash },
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;700&family=Inter+Tight:wght@400;500;700&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

type Channel = { _id: string; slug: string; channelType: string; name: string; lastMessagePreview: string | null; lastSender: string | null; lastWhen: string | null; unreadCount: number };
type Group = { _id: string; name: string; image: string; groupTypeName: string; userRole: 'leader' | 'member'; channels: Channel[] };

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
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: C.ink }} />
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.tomato, borderWidth: 2, borderColor: C.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: 'rgba(0,0,0,0.08)', color: C.ink };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.mono, fontSize: 9, fontWeight: '700', color: s.color, letterSpacing: 2, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function preview(ch: Channel) {
  if (!ch.lastMessagePreview) return 'No messages yet';
  if (ch.lastSender) return `${ch.lastSender}: ${ch.lastMessagePreview}`;
  return ch.lastMessagePreview;
}

function GroupRow({ g, active }: { g: Group; active?: boolean }) {
  const total = g.channels.reduce((s, c) => s + c.unreadCount, 0);
  const main = g.channels.find((c) => c.channelType === 'main') || g.channels[0];
  const multi = g.channels.length > 1;
  const secondary = g.channels.filter((c) => c._id !== main._id && c.unreadCount > 0);
  const hasUnread = total > 0;

  return (
    <View style={{ backgroundColor: active ? C.band : 'transparent', borderTopWidth: 1, borderTopColor: C.ink }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 14,
        backgroundColor: hasUnread ? C.unreadBg : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 22, color: C.ink, flex: 1, marginRight: 8, letterSpacing: -0.4 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.display, fontStyle: 'italic', fontSize: 15, flex: 1, marginRight: 8,
              color: (multi ? hasUnread : main.unreadCount > 0) ? C.ink : C.ash,
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1,
                color: main.unreadCount > 0 ? C.tomato : C.ash,
                fontWeight: main.unreadCount > 0 ? '700' : '400',
              }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {total > 0 && (
          <View style={{ minWidth: 22, height: 22, backgroundColor: C.tomato, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, marginLeft: 10 }}>
            <Text style={{ fontFamily: F.mono, color: C.paper, fontSize: 11, fontWeight: '700' }}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const cur = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', paddingLeft: 16 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.ink }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.ink }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 16, marginBottom: 8, marginTop: 4,
              borderWidth: 1,
              backgroundColor: cur ? C.unreadBgSub : C.band,
              borderColor: cur ? C.unreadBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 15, color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.display, fontStyle: 'italic', fontSize: 13, color: cur ? C.ink : C.ash }}>{preview(ch)}</Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginLeft: 8, color: cur ? C.tomato : C.ash, fontWeight: cur ? '700' : '400' }}>{ch.lastWhen}</Text>
              )}
              {cur && (
                <View style={{ minWidth: 20, height: 20, backgroundColor: C.tomato, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.mono, color: C.paper, fontSize: 10, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design2() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <DesktopView /> : <MobileView />;
}

function MobileView() {
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 14 }}>
        <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, fontWeight: '700', letterSpacing: -0.8 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
        <View style={{ borderTopWidth: 1, borderTopColor: C.ink }} />
      </ScrollView>
      <View style={{ flexDirection: 'row', paddingVertical: 10, paddingBottom: 22, backgroundColor: C.band, borderTopWidth: 1, borderTopColor: C.ink }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 3, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.tomato : C.ash} />
            <Text style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 2, color: t.active ? C.ink : C.ash, textTransform: 'uppercase', fontWeight: t.active ? '700' : '400' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DesktopView() {
  const g = groups[0];
  const ch = g.channels[0];
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.paper }}>
      <View style={{ width: 72, backgroundColor: C.ink, alignItems: 'center', paddingTop: 28, gap: 6 }}>
        <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 24, color: C.paper, marginBottom: 14 }}>T.</Text>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 56, paddingVertical: 10, alignItems: 'center', gap: 3, borderRadius: 6, backgroundColor: t.active ? 'rgba(226,75,42,0.2)' : 'transparent' }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.tomato : 'rgba(246,242,231,0.6)'} />
            <Text style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: 2, color: t.active ? C.paper : 'rgba(246,242,231,0.55)', textTransform: 'uppercase' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 380, borderRightWidth: 1, borderRightColor: C.ink }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 28, paddingBottom: 16 }}>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, fontWeight: '700', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
          <View style={{ borderTopWidth: 1, borderTopColor: C.ink }} />
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.ink, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={{ uri: g.image }} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.ink }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: F.display, fontSize: 22, color: C.ink, letterSpacing: -0.6 }}>{g.name}</Text>
              <TypeBadge label={g.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 14, color: C.ash, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={C.ash} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 24, paddingTop: 14, gap: 20, borderBottomWidth: 1, borderBottomColor: C.ink, alignItems: 'center' }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.tomato : 'transparent' }}>
              <Text style={{ fontFamily: F.display, fontSize: 17, color: t.active ? C.ink : C.ash, fontStyle: t.active ? 'normal' : 'italic' }}>{t.l}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 10, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const },
              { l: 'People', v: '17', i: 'people-outline' as const },
              { l: 'Events', v: '3', i: 'calendar-outline' as const },
              { l: 'Bots', v: null, i: 'hardware-chip-outline' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.band, borderWidth: 1, borderColor: C.rule }}>
                <Ionicons name={s.i} size={13} color={C.ash} />
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.ink, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.tomato, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={48} color={C.tomato} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.6 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 16, color: C.ash, marginTop: 8, textAlign: 'center' }}>Start a conversation with {g.name}.</Text>
        </ScrollView>

        <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: C.ink, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={22} color={C.ash} />
          </Pressable>
          <View style={{ flex: 1, backgroundColor: C.band, paddingHorizontal: 14, height: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.rule }}>
            <TextInput
              placeholder={`Message ${ch.name}`}
              placeholderTextColor={C.ash}
              style={{ fontFamily: F.display, fontSize: 15, color: C.ink, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ width: 40, height: 40, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color={C.paper} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
