import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// "Hearth" — warm dark · serif display · ember glow
const C = {
  bg: '#15110E',
  surface: '#1E1915',
  surfaceHi: '#2A241F',
  surfaceGlow: '#352C25',
  ink: '#F5EEE3',
  inkSoft: '#D8CFC2',
  subtle: '#9A8F80',
  faint: '#6A6058',
  rule: 'rgba(245,238,227,0.08)',
  accent: '#E67A3C',
  accentBright: '#F7A06B',
  accentSoft: 'rgba(230,122,60,0.14)',
  accentSub: 'rgba(230,122,60,0.22)',
  accentBorder: 'rgba(230,122,60,0.40)',
  avatarBg: '#2A241F',
};

const F = {
  serif: '"Fraunces", Georgia, serif',
  sans: '"DM Sans", system-ui, sans-serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,500&family=DM+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(135, 200, 120, 0.14)', color: '#9AD38A' },
  Teams: { bg: 'rgba(140, 185, 240, 0.14)', color: '#A6C5EE' },
  Classes: { bg: 'rgba(230, 122, 60, 0.16)', color: '#F7A06B' },
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
  { label: 'Inbox', icon: 'email-outline' as const, activeIcon: 'email' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'account-outline' as const, activeIcon: 'account' as const },
];

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.avatarBg, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Image source={{ uri: g.image }} style={{ width: 54, height: 54, borderRadius: 27 }} />
      </View>
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="shield" size={11} color={C.bg} />
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
        paddingHorizontal: 16, paddingVertical: 12,
        marginHorizontal: 10, marginVertical: 3,
        borderRadius: 16,
        backgroundColor: active ? C.surfaceGlow : hasUnread ? C.accentSoft : 'transparent',
        ...(active ? { shadowColor: C.accent, shadowOpacity: 0.25, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } } : {}),
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 16, fontWeight: hasUnread ? '700' : '600', color: C.ink, flex: 1, marginRight: 8, letterSpacing: -0.3 }}>{g.name}</Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13.5, flex: 1, marginRight: 8,
              color: (isMulti ? hasUnread : main.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMulti ? hasUnread : main.unreadCount > 0) ? '600' : '400',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 11.5, color: main.unreadCount > 0 ? C.accentBright : C.faint, fontWeight: main.unreadCount > 0 ? '600' : '500' }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
            <Text style={{ fontFamily: F.sans, color: C.bg, fontSize: 11, fontWeight: '700' }}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const chUn = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 20 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 18, backgroundColor: C.rule }} />
              <View style={{ position: 'absolute', left: 28, top: 18, width: 12, height: 1.5, backgroundColor: C.rule }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 20, marginBottom: 6, marginTop: 2,
              backgroundColor: chUn ? C.accentSub : C.surfaceHi,
              borderWidth: 1, borderColor: chUn ? C.accentBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.serif, fontSize: 13.5, fontWeight: chUn ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.sans, flex: 1, fontSize: 13, color: chUn ? C.ink : C.subtle, fontWeight: chUn ? '500' : '400' }}>{preview(ch)}</Text>
              {ch.lastWhen && <Text style={{ fontFamily: F.sans, fontSize: 11, marginLeft: 8, color: chUn ? C.accentBright : C.faint, fontWeight: chUn ? '600' : '500' }}>{ch.lastWhen}</Text>}
              {chUn && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.sans, color: C.bg, fontSize: 11, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design14() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '600', letterSpacing: -0.8 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{ position: 'absolute' as any, bottom: 16, left: 16, right: 16, flexDirection: 'row', padding: 8, borderRadius: 30, backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 22, backgroundColor: t.active ? C.accentSoft : 'transparent', gap: 3 }}>
            <MaterialCommunityIcons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accentBright : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
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
      <View style={{ width: 84, paddingTop: 32, alignItems: 'center', gap: 10, borderRightWidth: 1, borderRightColor: C.rule }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 60, paddingVertical: 12, alignItems: 'center', borderRadius: 14, gap: 5, backgroundColor: t.active ? C.surfaceHi : 'transparent' }}>
            <MaterialCommunityIcons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accentBright : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 9.5, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, borderRightWidth: 1, borderRightColor: C.rule }}>
        <View style={{ paddingHorizontal: 26, paddingTop: 32, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '600', letterSpacing: -0.8 }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ paddingHorizontal: 32, paddingTop: 22, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.rule, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.accent, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: activeGroup.image }} style={{ width: 40, height: 40, borderRadius: 20 }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 20, color: C.ink, fontWeight: '600', letterSpacing: -0.5 }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.sans, fontSize: 12.5, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceHi, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="dots-horizontal" size={20} color={C.inkSoft} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 32, paddingTop: 12, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.rule }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.rule, marginBottom: 10 }}>
            {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
              <Pressable key={i} style={{ paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8, backgroundColor: t.active ? C.surfaceGlow : 'transparent' }}>
                <Text style={{ fontFamily: F.sans, fontSize: 12.5, color: t.active ? C.ink : C.subtle, fontWeight: '600' }}>{t.l}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'check-circle-outline' as const },
              { l: 'People', v: '17', i: 'account-group-outline' as const },
              { l: 'Events', v: '3', i: 'calendar-blank-outline' as const },
              { l: 'Bots', v: null, i: 'chip' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.rule }}>
                <MaterialCommunityIcons name={s.i as any} size={13} color={C.accentBright} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.inkSoft, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: C.accentSoft,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: C.accent, shadowOpacity: 0.4, shadowRadius: 40, shadowOffset: { width: 0, height: 0 },
            borderWidth: 1, borderColor: C.accent, marginBottom: 20,
          }}>
            <MaterialCommunityIcons name="message-outline" size={40} color={C.accentBright} />
          </View>
          <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.ink, fontWeight: '600', marginBottom: 8, letterSpacing: -0.6 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 18, borderTopWidth: 1, borderTopColor: C.rule }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.surface, borderRadius: 24, paddingLeft: 8, paddingRight: 8, paddingVertical: 6, borderWidth: 1, borderColor: C.rule }}>
            <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceHi, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="paperclip" size={18} color={C.inkSoft} />
            </Pressable>
            <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any, paddingVertical: 8 }} />
            <Pressable style={{
              width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
              shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
            }}>
              <MaterialCommunityIcons name="arrow-up" size={18} color={C.bg} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
