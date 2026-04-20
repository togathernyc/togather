import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';

// "Atelier" — letterpress quiet · sage on cotton · coral seal
const C = {
  bg: '#F6F1E7',
  paper: '#FBF7ED',
  ink: '#222621',
  inkSoft: '#37403A',
  subtle: '#6C6F66',
  faint: '#A7A79B',
  rule: 'rgba(34,38,33,0.10)',
  ruleSoft: 'rgba(34,38,33,0.05)',
  accent: '#C95443',
  accentInk: '#872E21',
  accentSoft: 'rgba(201,84,67,0.08)',
  accentSoftHi: 'rgba(201,84,67,0.16)',
  sage: '#6A8068',
  sageSoft: 'rgba(106,128,104,0.14)',
};

const F = {
  serif: '"Crimson Pro", Georgia, serif',
  sans: '"Manrope", system-ui, sans-serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Manrope:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: C.sageSoft, color: C.sage },
  Teams: { bg: 'rgba(10,90,140,0.12)', color: '#2F5E7E' },
  Classes: { bg: C.accentSoft, color: C.accentInk },
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
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: C.rule }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: C.accent, borderWidth: 2, borderColor: C.paper,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="shield" size={10} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.sageSoft, color: C.sage };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 10.5, fontWeight: '700', color: scheme.color, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? C.accentSoft : 'transparent', borderBottomWidth: 1, borderBottomColor: C.ruleSoft }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 24, paddingVertical: 16,
        backgroundColor: hasUnread && !active ? C.accentSoft : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, fontWeight: '500', letterSpacing: -0.3, flex: 1 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.serif, fontSize: 15, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '500' : '400',
            }}>{messagePreview(mainChannel)}</Text>
            {mainChannel.lastWhen && (
              <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 12, color: mainChannel.unreadCount > 0 ? C.accent : C.faint }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 24, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 10 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.paper, fontWeight: '700' }}>{totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 24 }}>
            <View style={{ width: 46 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1, height: 22, backgroundColor: C.rule }} />
              <View style={{ position: 'absolute', left: 28, top: 22, width: 14, height: 1, backgroundColor: C.rule }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
              marginRight: 24, marginBottom: 12, marginTop: 4,
              backgroundColor: chHasUnread ? C.accentSoftHi : C.paper,
              borderWidth: 1, borderColor: chHasUnread ? C.accent : C.rule,
            }}>
              <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 14, fontWeight: '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.serif, fontSize: 14, color: chHasUnread ? C.ink : C.subtle, fontWeight: chHasUnread ? '500' : '400' }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 11, marginLeft: 8, color: chHasUnread ? C.accent : C.faint }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.sans, color: C.paper, fontSize: 11, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design19() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center' }}>
      <View style={{ width: '100%' as any, maxWidth: 540, flex: 1, backgroundColor: C.paper }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: C.ink, fontWeight: '500', letterSpacing: -0.6 }}>Inbox</Text>
        </View>
        <View style={{ height: 1, backgroundColor: C.rule, marginHorizontal: 24 }} />
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          {groups.map((g) => <GroupRow key={g._id} g={g} />)}
        </ScrollView>
        <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: C.paper, borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 10, paddingBottom: 22 }}>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 5, paddingTop: 8 }}>
              <Feather name={t.icon} size={19} color={t.active ? C.accent : C.subtle} />
              <Text style={{ fontFamily: F.serif, fontStyle: t.active ? 'italic' : 'normal', fontSize: 12, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>
                {t.label}
              </Text>
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
      <View style={{ width: 92, backgroundColor: C.paper, borderRightWidth: 1, borderRightColor: C.rule, paddingTop: 36, alignItems: 'center', gap: 4 }}>
        <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 28, color: C.accent, fontWeight: '500' }}>Tg</Text>
        <View style={{ width: 20, height: 1, backgroundColor: C.rule, marginTop: 8, marginBottom: 18 }} />
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ width: 72, paddingVertical: 14, alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 42, height: 42, borderRadius: 21,
              borderWidth: 1, borderColor: t.active ? C.accent : 'transparent',
              backgroundColor: t.active ? C.accentSoft : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name={t.icon} size={18} color={t.active ? C.accent : C.subtle} />
            </View>
            <Text style={{ fontFamily: F.serif, fontStyle: t.active ? 'italic' : 'normal', fontSize: 13, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderRightWidth: 1, borderRightColor: C.rule }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 28, paddingBottom: 14 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: C.ink, fontWeight: '500', letterSpacing: -0.6 }}>Inbox</Text>
        </View>
        <View style={{ height: 1, backgroundColor: C.rule }} />
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View style={{ padding: 24, borderBottomWidth: 1, borderBottomColor: C.rule, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: C.rule }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 26, color: C.ink, fontWeight: '500', letterSpacing: -0.6 }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 14, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="more-horizontal" size={18} color={C.subtle} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingTop: 14, gap: 24, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.accent : 'transparent' }}>
              <Text style={{ fontFamily: F.serif, fontSize: 15, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '600' : '400', fontStyle: t.active ? 'italic' : 'normal' }}>{t.l}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
            {[
              { l: 'Attendance', v: '23', i: 'check-circle' as const },
              { l: 'People', v: '17', i: 'users' as const },
              { l: 'Events', v: '3', i: 'calendar' as const },
              { l: 'Bots', v: null as any, i: 'cpu' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.sageSoft }}>
                <Feather name={s.i} size={13} color={C.sage} />
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.inkSoft, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 13, color: C.accent, fontWeight: '600' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: C.accent,
            alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentSoft, marginBottom: 18,
          }}>
            <Feather name="message-circle" size={28} color={C.accent} />
          </View>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: C.ink, fontWeight: '500', letterSpacing: -0.6, marginBottom: 8 }}>No messages yet</Text>
          <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 15, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: C.rule, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Pressable style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="paperclip" size={16} color={C.subtle} />
          </Pressable>
          <View style={{ flex: 1, backgroundColor: C.bg, borderRadius: 20, paddingHorizontal: 14, height: 40, justifyContent: 'center' }}>
            <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ fontFamily: F.serif, fontSize: 15, color: C.ink, outlineWidth: 0 as any }} />
          </View>
          <Pressable style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="arrow-up" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
