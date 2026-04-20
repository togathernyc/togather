import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Conservatory — EB Garamond
const C = {
  base: '#E4E8DE',
  tint1: '#F3E9D2',
  tint2: '#D0DAE4',
  tint3: '#E9D5D9',
  glass: 'rgba(255,255,255,0.55)',
  glassHi: 'rgba(255,255,255,0.78)',
  glassDim: 'rgba(255,255,255,0.32)',
  ink: '#1B2620',
  subtle: '#4C5A51',
  faint: '#8A9489',
  rule: 'rgba(27,38,32,0.10)',
  ruleSoft: 'rgba(27,38,32,0.05)',
  accent: '#1C6B5E',
  accentInk: '#0F443B',
  accentSoft: 'rgba(28,107,94,0.14)',
  avatarBg: 'rgba(255,255,255,0.6)',
  unreadBg: 'rgba(28,107,94,0.08)',
  unreadBgSub: 'rgba(28,107,94,0.12)',
  unreadBorder: 'rgba(28,107,94,0.35)',
};

const F = {
  sans: '"Manrope", system-ui, sans-serif',
  serif: '"EB Garamond", Georgia, serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(76, 175, 80, 0.1)', color: '#4CAF50' },
  Teams: { bg: 'rgba(10, 132, 255, 0.1)', color: '#0A84FF' },
  Classes: { bg: 'rgba(255, 149, 0, 0.1)', color: '#FF9500' },
};

type Channel = {
  _id: string;
  slug: string;
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
  {
    _id: 'ya',
    name: 'Young Adults',
    image: 'https://picsum.photos/seed/togather-ya/200/200',
    groupTypeName: 'Small Groups',
    userRole: 'member',
    channels: [
      { _id: 'ya-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Bring a chair Thursday.', lastSender: 'Maya', lastWhen: '9m', unreadCount: 3 },
    ],
  },
  {
    _id: 'sg',
    name: 'Small Group Alpha',
    image: 'https://picsum.photos/seed/togather-sg/200/200',
    groupTypeName: 'Small Groups',
    userRole: 'member',
    channels: [
      { _id: 'sg-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Cornbread is covered.', lastSender: 'Ruth', lastWhen: '1h', unreadCount: 0 },
    ],
  },
  {
    _id: 'wt',
    name: 'Worship Team',
    image: 'https://picsum.photos/seed/togather-wt/200/200',
    groupTypeName: 'Teams',
    userRole: 'leader',
    channels: [
      { _id: 'wt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Saturday 10am sharp.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 0 },
      { _id: 'wt-l', slug: 'leaders', channelType: 'leaders', name: 'Leaders', lastMessagePreview: 'Setlist draft attached.', lastSender: 'Ade', lastWhen: 'Yesterday', unreadCount: 1 },
    ],
  },
  {
    _id: 'tt',
    name: 'Tech Team',
    image: 'https://picsum.photos/seed/togather-tt/200/200',
    groupTypeName: 'Teams',
    userRole: 'member',
    channels: [
      { _id: 'tt-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Projector keys, vestibule.', lastSender: 'James', lastWhen: 'Tue', unreadCount: 0 },
    ],
  },
  {
    _id: 'nm',
    name: 'New Members Class',
    image: 'https://picsum.photos/seed/togather-nm/200/200',
    groupTypeName: 'Classes',
    userRole: 'leader',
    channels: [
      { _id: 'nm-m', slug: 'general', channelType: 'main', name: 'General', lastMessagePreview: 'Four RSVPs for Sunday.', lastSender: 'Dorothy', lastWhen: 'Sun', unreadCount: 0 },
    ],
  },
];

const tabs = [
  { label: 'Explore', icon: 'compass-outline' as const, activeIcon: 'compass' as const },
  { label: 'Inbox', icon: 'chatbubbles-outline' as const, activeIcon: 'chatbubbles' as const, active: true },
  { label: 'Admin', icon: 'shield-outline' as const, activeIcon: 'shield' as const },
  { label: 'Profile', icon: 'person-outline' as const, activeIcon: 'person' as const },
];

function Backdrop() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute' as any, inset: 0, overflow: 'hidden' } as any}>
      <View style={{ position: 'absolute' as any, width: 520, height: 520, borderRadius: 260, backgroundColor: C.tint1, top: -120, left: -140, opacity: 0.75 }} />
      <View style={{ position: 'absolute' as any, width: 640, height: 640, borderRadius: 320, backgroundColor: C.tint2, bottom: -220, right: -200, opacity: 0.85 }} />
      <View style={{ position: 'absolute' as any, width: 380, height: 380, borderRadius: 190, backgroundColor: C.tint3, top: '35%' as any, left: '40%' as any, opacity: 0.5 }} />
    </View>
  );
}

function Avatar({ g, size = 56 }: { g: Group; size?: number }) {
  const badge = Math.round(size * 0.36);
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <Image source={{ uri: g.image }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.avatarBg }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: badge, height: badge, borderRadius: badge / 2,
          backgroundColor: C.accent, borderWidth: 2, borderColor: '#fff',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="shield" size={Math.round(badge * 0.6)} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accent };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 11, fontWeight: '600', color: scheme.color }}>{label}</Text>
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
    <View style={{
      marginHorizontal: 12, marginBottom: 8, borderRadius: 20,
      backgroundColor: active ? C.glassHi : (hasUnread ? C.unreadBg : C.glassDim),
      borderWidth: 1,
      borderColor: active ? 'rgba(255,255,255,0.9)' : C.ruleSoft,
      overflow: 'hidden',
    }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 12,
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 19, color: C.ink, letterSpacing: -0.3, flex: 1, marginRight: 8 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '600' : '400',
            }}>
              {messagePreview(mainChannel)}
            </Text>
            {mainChannel.lastWhen && (
              <Text style={{
                fontFamily: F.sans, fontSize: 11,
                color: mainChannel.unreadCount > 0 ? C.accent : C.faint,
                fontWeight: mainChannel.unreadCount > 0 ? '600' : '500',
              }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{
            minWidth: 22, height: 22, borderRadius: 11,
            backgroundColor: C.accent,
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 6, marginLeft: 8,
          }}>
            <Text style={{ fontFamily: F.sans, color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 14 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.rule }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.rule }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 14, marginBottom: 10, marginTop: 4,
              borderWidth: 1,
              backgroundColor: chHasUnread ? C.unreadBgSub : C.glassDim,
              borderColor: chHasUnread ? C.unreadBorder : C.ruleSoft,
            }}>
              <Text style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: chHasUnread ? '700' : '600', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{
                fontFamily: F.sans, flex: 1, fontSize: 12.5,
                color: chHasUnread ? C.ink : C.subtle,
                fontWeight: chHasUnread ? '500' : '400',
              }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{
                  fontFamily: F.sans, fontSize: 11, marginLeft: 8,
                  color: chHasUnread ? C.accent : C.faint,
                  fontWeight: chHasUnread ? '600' : '500',
                }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{
                  minWidth: 20, height: 20, borderRadius: 10,
                  backgroundColor: C.accent,
                  alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 5, marginLeft: 8,
                }}>
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

export default function Design26() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.base }}>
      <Backdrop />
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.5 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{
        position: 'absolute' as any, bottom: 18, left: 14, right: 14,
        flexDirection: 'row', padding: 6, borderRadius: 28,
        backgroundColor: C.glassHi, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
      }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 22, backgroundColor: t.active ? C.accent : 'transparent', gap: 3 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? '#fff' : C.subtle} />
            <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? '#fff' : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
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
    <View style={{ flex: 1, backgroundColor: C.base }}>
      <Backdrop />
      <View style={{ flex: 1, flexDirection: 'row', padding: 20, gap: 18 }}>
        <View style={{ width: 92, paddingTop: 12, alignItems: 'center', gap: 10 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 24, color: '#fff' }}>t</Text>
          </View>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{
              width: 76, paddingVertical: 14, alignItems: 'center', gap: 5, borderRadius: 20,
              backgroundColor: t.active ? C.glassHi : C.glassDim,
              borderWidth: 1, borderColor: t.active ? 'rgba(255,255,255,0.9)' : C.ruleSoft,
            }}>
              <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.accentInk : C.subtle} />
              <Text style={{ fontFamily: F.sans, fontSize: 10.5, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ width: 400, backgroundColor: C.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 32, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.5 }}>Inbox</Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}>
            {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
          </ScrollView>
        </View>

        <View style={{ flex: 1, backgroundColor: C.glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 32, overflow: 'hidden' }}>
          <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: C.ruleSoft, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Image source={{ uri: activeGroup.image }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.avatarBg }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, letterSpacing: -0.4 }}>{activeGroup.name}</Text>
                <TypeBadge label={activeGroup.groupTypeName} />
              </View>
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
            </View>
            <Pressable style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.glassHi, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="ellipsis-horizontal" size={18} color={C.subtle} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, gap: 16, borderBottomWidth: 1, borderBottomColor: C.ruleSoft, alignItems: 'center' }}>
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
                { l: 'Bots', v: null as any, i: 'hardware-chip-outline' as const },
              ].map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.glassHi, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' }}>
                  <Ionicons name={s.i} size={13} color={C.accentInk} />
                  <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '600' }}>{s.l}</Text>
                  {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
                </View>
              ))}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <Ionicons name="chatbubbles-outline" size={48} color={C.faint} style={{ marginBottom: 16 }} />
            <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.ink, marginBottom: 8, letterSpacing: -0.4 }}>No messages yet</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
          </ScrollView>

          <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: C.ruleSoft, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.glassHi, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color={C.subtle} />
            </Pressable>
            <View style={{ flex: 1, backgroundColor: C.glassHi, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 20, paddingHorizontal: 14, height: 40, justifyContent: 'center' }}>
              <TextInput
                placeholder={`Message ${activeChannel.name}`}
                placeholderTextColor={C.faint}
                style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any }}
              />
            </View>
            <Pressable style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-up" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
