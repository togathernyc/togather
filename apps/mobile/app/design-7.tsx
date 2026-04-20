import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Notes" — Apple Notes paper restraint · serif-led
const C = {
  bg: '#FBF9F3',
  paper: '#FFFDF7',
  ink: '#1C1A17',
  subtle: '#6E6A62',
  faint: '#9B9790',
  divider: 'rgba(28,26,23,0.08)',
  accent: '#B8823C',
  accentSoft: 'rgba(184,130,60,0.08)',
  accentSofter: 'rgba(184,130,60,0.14)',
  unreadBorder: 'rgba(184,130,60,0.32)',
};

const F = {
  serif: '"Newsreader", "Charter", Georgia, serif',
  sans: '"Geist", system-ui, sans-serif',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76,175,80,0.12)', color: '#4C7A3A' },
  Teams: { bg: 'rgba(10,132,255,0.1)', color: '#3A6FA8' },
  Classes: { bg: 'rgba(184,130,60,0.14)', color: C.accent },
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400&family=Geist:wght@400;500;600&display=swap';
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
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.paper, borderWidth: 1, borderColor: C.divider }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10,
          backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg,
          alignItems: 'center', justifyContent: 'center',
        }}>
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
      <Text style={{ fontFamily: F.sans, fontSize: 10, fontWeight: '600', color: s.color, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? C.accentSoft : 'transparent', borderBottomWidth: 1, borderBottomColor: C.divider }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 18, paddingVertical: 14,
        backgroundColor: hasUnread ? C.accentSoft : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 18, fontWeight: hasUnread ? '700' : '600', color: C.ink, flex: 1, marginRight: 8, letterSpacing: -0.2 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.serif, fontSize: 14, flex: 1, marginRight: 8,
              color: (multi ? hasUnread : main.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (multi ? hasUnread : main.unreadCount > 0) ? '500' : '400',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 11, letterSpacing: 0.3,
                color: main.unreadCount > 0 ? C.accent : C.faint,
                fontWeight: main.unreadCount > 0 ? '600' : '400',
              }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {total > 0 && (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 10 }}>
            <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 11, fontWeight: '700' }}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const cur = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', paddingLeft: 18 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.divider }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.divider }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 18, marginBottom: 8, marginTop: 4,
              borderWidth: 1,
              backgroundColor: cur ? C.accentSofter : C.paper,
              borderColor: cur ? C.unreadBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.serif, fontSize: 14, fontWeight: cur ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.serif, fontSize: 13, color: cur ? C.ink : C.subtle }}>{preview(ch)}</Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.sans, fontSize: 10, marginLeft: 8, color: cur ? C.accent : C.faint, fontWeight: cur ? '600' : '400', letterSpacing: 0.3 }}>{ch.lastWhen}</Text>
              )}
              {cur && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 10, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design7() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <DesktopView /> : <MobileView />;
}

function MobileView() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 14 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '700', letterSpacing: -0.8 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', paddingVertical: 10, paddingBottom: 22, borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.paper }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 3, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.accent : C.faint} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.ink : C.faint, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
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
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: 80, paddingTop: 28, gap: 6, alignItems: 'center' }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            width: 60, paddingVertical: 10, alignItems: 'center', gap: 4, borderRadius: 10,
            backgroundColor: t.active ? C.accentSoft : 'transparent',
          }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accent : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderLeftWidth: 1, borderLeftColor: C.divider, borderRightWidth: 1, borderRightColor: C.divider }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 30, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '700', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 28, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.divider, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={{ uri: g.image }} style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: C.divider }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, fontWeight: '700', letterSpacing: -0.5 }}>{g.name}</Text>
              <TypeBadge label={g.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 13, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={C.faint} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 28, paddingTop: 14, gap: 20, borderBottomWidth: 1, borderBottomColor: C.divider, alignItems: 'center' }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.accent : 'transparent' }}>
              <Text style={{ fontFamily: F.serif, fontSize: 15, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.l}</Text>
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
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.paper, borderWidth: 1, borderColor: C.divider }}>
                <Ionicons name={s.i} size={13} color={C.subtle} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '500' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '600' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={48} color={C.accent} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.ink, fontWeight: '700' }}>No messages yet</Text>
          <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 15, color: C.subtle, marginTop: 6, textAlign: 'center' }}>Start a conversation with {g.name}.</Text>
        </ScrollView>

        <View style={{ paddingHorizontal: 28, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.divider, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={22} color={C.subtle} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider }}>
            <TextInput
              placeholder={`Message ${ch.name}`}
              placeholderTextColor={C.faint}
              style={{ fontFamily: F.serif, fontSize: 16, color: C.ink, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
