import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Console" — warm monospace · terminal buffer with a beating heart
const C = {
  bg: '#F4EFE4',
  paper: '#FBF7EC',
  paperHi: '#FFFCF3',
  ink: '#1C1A16',
  inkSoft: '#2E2B25',
  subtle: '#5F594E',
  faint: '#9A9387',
  rule: 'rgba(28,26,22,0.10)',
  ruleSoft: 'rgba(28,26,22,0.05)',
  accent: '#CC7A1A',
  accentSoft: 'rgba(204,122,26,0.12)',
  accentSoftHi: 'rgba(204,122,26,0.20)',
  green: '#5B7A3E',
  greenSoft: 'rgba(91,122,62,0.12)',
  blue: '#3B5E8A',
  blueSoft: 'rgba(59,94,138,0.14)',
};

const F = {
  mono: '"JetBrains Mono", ui-monospace, monospace',
  sans: '"Manrope", system-ui, sans-serif',
  serif: '"Fraunces", Georgia, serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: C.greenSoft, color: C.green },
  Teams: { bg: C.blueSoft, color: C.blue },
  Classes: { bg: C.accentSoft, color: C.accent },
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
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function TrafficDots() {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.accent }} />
      <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.green }} />
      <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.faint }} />
    </View>
  );
}

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 14 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: C.rule }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 20, height: 20, borderRadius: 6,
          backgroundColor: C.accent, borderWidth: 2, borderColor: C.paper,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="shield" size={11} color={C.paperHi} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10.5, fontWeight: '700', color: scheme.color, letterSpacing: 0.3 }}>#{label.toLowerCase().replace(' ', '-')}</Text>
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
        paddingHorizontal: 18, paddingVertical: 14,
        backgroundColor: hasUnread && !active ? C.accentSoft : 'transparent',
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 15, color: C.ink, fontWeight: '600', flex: 1 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.mono, fontSize: 12.5, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '600' : '400',
            }}><Text style={{ color: C.faint }}>{'> '}</Text>{messagePreview(mainChannel)}</Text>
            {mainChannel.lastWhen && (
              <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: mainChannel.unreadCount > 0 ? C.accent : C.faint, fontWeight: mainChannel.unreadCount > 0 ? '700' : '500', letterSpacing: 0.5 }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{ minWidth: 26, height: 22, borderRadius: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, marginLeft: 10 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.paperHi, fontWeight: '700' }}>+{totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 18 }}>
            <View style={{ width: 44 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.rule }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.rule }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9,
              marginRight: 18, marginBottom: 10, marginTop: 4,
              backgroundColor: chHasUnread ? C.accentSoftHi : C.paperHi,
              borderWidth: 1, borderColor: chHasUnread ? C.accent : C.rule,
            }}>
              <Text style={{ fontFamily: F.mono, fontSize: 12, fontWeight: '700', color: C.ink, marginRight: 8 }}>#{ch.name.toLowerCase()}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.mono, fontSize: 12, color: chHasUnread ? C.ink : C.subtle, fontWeight: chHasUnread ? '500' : '400' }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.mono, fontSize: 10, marginLeft: 8, color: chHasUnread ? C.accent : C.faint, fontWeight: chHasUnread ? '700' : '500' }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{ minWidth: 22, height: 18, borderRadius: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.mono, color: C.paperHi, fontSize: 10, fontWeight: '700' }}>+{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design20() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center' }}>
      <View style={{ width: '100%' as any, maxWidth: 540, flex: 1, backgroundColor: C.paper }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          <Text style={{ fontFamily: F.mono, fontSize: 28, color: C.ink, fontWeight: '700', letterSpacing: -1 }}>
            inbox<Text style={{ color: C.accent }}>_</Text>
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
          {groups.map((g) => <GroupRow key={g._id} g={g} />)}
        </ScrollView>
        <View style={{ position: 'absolute' as any, bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: C.paperHi, borderTopWidth: 1, borderTopColor: C.ink, paddingVertical: 8, paddingBottom: 22 }}>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 6 }}>
              <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.accent : C.subtle} />
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
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
      <View style={{ width: 80, backgroundColor: C.paperHi, borderRightWidth: 1, borderRightColor: C.rule, paddingTop: 24, alignItems: 'center', gap: 4 }}>
        <View style={{ marginBottom: 16 }}>
          <TrafficDots />
        </View>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            width: 64, paddingVertical: 12, alignItems: 'center', gap: 4, borderRadius: 8,
            backgroundColor: t.active ? C.accentSoft : 'transparent',
            borderWidth: 1, borderColor: t.active ? C.accent : 'transparent',
          }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accent : C.subtle} />
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400, backgroundColor: C.paper, borderRightWidth: 1, borderRightColor: C.rule }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 28, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          <Text style={{ fontFamily: F.mono, fontSize: 28, color: C.ink, fontWeight: '700', letterSpacing: -1 }}>
            inbox<Text style={{ color: C.accent }}>_</Text>
          </Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, backgroundColor: C.paperHi }}>
        <View style={{ padding: 22, borderBottomWidth: 1, borderBottomColor: C.rule, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image source={{ uri: activeGroup.image }} style={{ width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: C.rule }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: C.ink, fontWeight: '700' }}>{activeGroup.name}</Text>
              <TypeBadge label={activeGroup.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.subtle, marginTop: 4 }}>
              <Text style={{ color: C.green }}>●</Text> 17 members · 11 online
            </Text>
          </View>
          <TrafficDots />
          <Pressable style={{ width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
            <Ionicons name="ellipsis-horizontal" size={16} color={C.subtle} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: C.rule }}>
          {[{ l: 'general', active: true }, { l: 'leaders' }].map((t, i) => (
            <Pressable key={i} style={{
              paddingVertical: 7, paddingHorizontal: 14, borderRadius: 6, marginBottom: 10,
              backgroundColor: t.active ? C.ink : 'transparent',
              borderWidth: 1, borderColor: t.active ? C.ink : C.rule,
            }}>
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: t.active ? C.accent : C.subtle, fontWeight: '600' }}>#{t.l}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 10 }}>
            {[
              { l: 'attendance', v: '23', i: 'checkmark-circle-outline' as const },
              { l: 'people', v: '17', i: 'people-outline' as const },
              { l: 'events', v: '3', i: 'calendar-outline' as const },
              { l: 'bots', v: null as any, i: 'hardware-chip-outline' as const },
            ].map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: C.paper, borderWidth: 1, borderColor: C.rule }}>
                <Ionicons name={s.i} size={13} color={C.accent} />
                <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink, fontWeight: '500' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, fontWeight: '700' }}>:{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="chatbubbles-outline" size={48} color={C.accent} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: F.mono, fontSize: 22, color: C.ink, fontWeight: '700', marginBottom: 8 }}>
            no messages yet<Text style={{ color: C.accent }}>_</Text>
          </Text>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
        </ScrollView>

        <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: C.rule, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.paper }}>
          <Text style={{ fontFamily: F.mono, fontSize: 14, color: C.accent, fontWeight: '700' }}>❯</Text>
          <Pressable style={{ width: 36, height: 36, borderRadius: 6, borderWidth: 1, borderColor: C.rule, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={20} color={C.subtle} />
          </Pressable>
          <View style={{ flex: 1, height: 40, borderRadius: 6, borderWidth: 1, borderColor: C.rule, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: C.paperHi }}>
            <TextInput
              placeholder={`message ${activeChannel.name.toLowerCase()}`}
              placeholderTextColor={C.faint}
              style={{ fontFamily: F.mono, fontSize: 13, color: C.ink, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={18} color={C.accent} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
