import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';

// "Atrium · Nocturne" — frosted translucency · warm peach glow on deep violet
const C = {
  base: '#15131C',
  tint1: '#3E2A24',
  tint2: '#1F1D33',
  tint3: '#2B261E',
  glass: 'rgba(255,255,255,0.06)',
  glassHi: 'rgba(255,255,255,0.12)',
  glassDim: 'rgba(255,255,255,0.04)',
  glassBorder: 'rgba(255,255,255,0.14)',
  glassBorderHi: 'rgba(255,255,255,0.22)',
  ink: '#F0E8DD',
  subtle: '#A89B8D',
  faint: '#716659',
  rule: 'rgba(255,255,255,0.10)',
  ruleSoft: 'rgba(255,255,255,0.05)',
  accent: '#F0866A',
  accentInk: '#F8A389',
  accentSoft: 'rgba(240,134,106,0.18)',
  accentSoftHi: 'rgba(240,134,106,0.28)',
};

const F = {
  sans: '"Manrope", system-ui, sans-serif',
  serif: '"Instrument Serif", Georgia, serif',
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(136,200,120,0.16)', color: '#9DD488' },
  Teams: { bg: 'rgba(120,180,240,0.16)', color: '#A9CFF5' },
  Classes: { bg: 'rgba(240,134,106,0.22)', color: '#F8A389' },
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

function Backdrop() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute' as any, inset: 0, overflow: 'hidden' }}>
      <View style={{ position: 'absolute' as any, width: 560, height: 560, borderRadius: 280, backgroundColor: C.tint1, top: -140, left: -160, opacity: 0.55 }} />
      <View style={{ position: 'absolute' as any, width: 680, height: 680, borderRadius: 340, backgroundColor: C.tint2, bottom: -240, right: -220, opacity: 0.75 }} />
      <View style={{ position: 'absolute' as any, width: 400, height: 400, borderRadius: 200, backgroundColor: C.tint3, top: '35%' as any, left: '40%' as any, opacity: 0.35 }} />
    </View>
  );
}

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <Image source={{ uri: g.image }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.glassHi }} />
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: C.accent, borderWidth: 2, borderColor: C.base,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.accent, shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        }}>
          <Feather name="shield" size={11} color={C.base} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const scheme = TYPE_COLORS[label] || { bg: C.accentSoft, color: C.accentInk };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: scheme.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 11, fontWeight: '700', color: scheme.color }}>{label}</Text>
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
      borderRadius: 20, marginBottom: 10, overflow: 'hidden',
      backgroundColor: active ? C.glassHi : (hasUnread ? C.accentSoft : C.glassDim),
      borderWidth: 1, borderColor: active ? C.glassBorderHi : (hasUnread ? C.accent : C.glassBorder),
    }}>
      <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 20, color: C.ink, fontWeight: '400', letterSpacing: -0.4, flex: 1, marginRight: 8 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.sans, fontSize: 13, flex: 1, marginRight: 8,
              color: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? C.ink : C.subtle,
              fontWeight: (isMultiChannel ? hasUnread : mainChannel.unreadCount > 0) ? '600' : '400',
            }}>{messagePreview(mainChannel)}</Text>
            {mainChannel.lastWhen && (
              <Text style={{ fontFamily: F.sans, fontSize: 11, color: mainChannel.unreadCount > 0 ? C.accentInk : C.faint, fontWeight: mainChannel.unreadCount > 0 ? '700' : '500' }}>
                {mainChannel.lastWhen}
              </Text>
            )}
          </View>
        </View>
        {totalUnread > 0 && (
          <View style={{
            minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, marginLeft: 10,
            shadowColor: C.accent, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
          }}>
            <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.base, fontWeight: '700' }}>{totalUnread}</Text>
          </View>
        )}
      </Pressable>

      {secondaryChannels.map((ch) => {
        const chHasUnread = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: 14 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 26, top: 0, width: 1.5, height: 20, backgroundColor: C.glassBorder }} />
              <View style={{ position: 'absolute', left: 26, top: 20, width: 12, height: 1.5, backgroundColor: C.glassBorder }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 14, marginBottom: 10, marginTop: 2,
              backgroundColor: chHasUnread ? C.accentSoftHi : C.glassHi,
              borderWidth: 1, borderColor: chHasUnread ? C.accent : C.glassBorder,
            }}>
              <Text style={{ fontFamily: F.sans, fontSize: 13, fontWeight: '700', color: C.ink, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: chHasUnread ? C.ink : C.subtle, fontWeight: chHasUnread ? '500' : '400' }}>
                {messagePreview(ch)}
              </Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.sans, fontSize: 11, marginLeft: 8, color: chHasUnread ? C.accentInk : C.faint, fontWeight: chHasUnread ? '700' : '500' }}>{ch.lastWhen}</Text>
              )}
              {chHasUnread && (
                <View style={{
                  minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent,
                  alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8,
                  shadowColor: C.accent, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
                }}>
                  <Text style={{ fontFamily: F.sans, color: C.base, fontSize: 11, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design22() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <Desktop /> : <Mobile />;
}

function Mobile() {
  return (
    <View style={{ flex: 1, backgroundColor: C.base }}>
      <Backdrop />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <View style={{ width: '100%' as any, maxWidth: 520, flex: 1 }}>
          <View style={{ paddingHorizontal: 18, paddingTop: 56, paddingBottom: 14 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '400', letterSpacing: -0.8 }}>Inbox</Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 14 }}>
            {groups.map((g) => <GroupRow key={g._id} g={g} />)}
          </ScrollView>
          <View style={{
            position: 'absolute' as any, bottom: 18, left: 14, right: 14,
            flexDirection: 'row', padding: 6, borderRadius: 28,
            backgroundColor: C.glassHi, borderWidth: 1, borderColor: C.glassBorder,
          }}>
            {tabs.map((t, i) => (
              <Pressable key={i} style={{
                flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 22, gap: 3,
                backgroundColor: t.active ? C.accent : 'transparent',
                ...(t.active ? { shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } } : {}),
              }}>
                <Feather name={t.icon} size={19} color={t.active ? C.base : C.subtle} />
                <Text style={{ fontFamily: F.sans, fontSize: 10, color: t.active ? C.base : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
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
      <View style={{ flex: 1, flexDirection: 'row', padding: 20, gap: 18, minHeight: '100%' as any }}>
        <View style={{ width: 92, paddingTop: 12, alignItems: 'center', gap: 10 }}>
          <View style={{
            width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 18,
            shadowColor: C.accent, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
          }}>
            <Text style={{ fontFamily: F.serif, fontSize: 22, color: C.base, fontStyle: 'italic', fontWeight: '600' }}>t</Text>
          </View>
          {tabs.map((t, i) => (
            <Pressable key={i} style={{
              width: 76, paddingVertical: 14, alignItems: 'center', gap: 5, borderRadius: 20,
              backgroundColor: t.active ? C.glassHi : C.glassDim,
              borderWidth: 1, borderColor: t.active ? C.glassBorderHi : C.glassBorder,
            }}>
              <Feather name={t.icon} size={19} color={t.active ? C.accent : C.subtle} />
              <Text style={{ fontFamily: F.sans, fontSize: 10.5, color: t.active ? C.ink : C.subtle, fontWeight: t.active ? '700' : '500' }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ width: 400, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder, borderRadius: 32, padding: 20 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 30, color: C.ink, fontWeight: '400', letterSpacing: -0.8, marginBottom: 14, paddingHorizontal: 4 }}>Inbox</Text>
          <ScrollView>
            {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
          </ScrollView>
        </View>

        <View style={{ flex: 1, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder, borderRadius: 32, overflow: 'hidden' }}>
          <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: C.ruleSoft, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Image source={{ uri: activeGroup.image }} style={{ width: 44, height: 44, borderRadius: 22 }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: F.serif, fontSize: 24, color: C.ink, fontWeight: '400', letterSpacing: -0.6 }}>{activeGroup.name}</Text>
                <TypeBadge label={activeGroup.groupTypeName} />
              </View>
              <Text style={{ fontFamily: F.sans, fontSize: 12.5, color: C.subtle, marginTop: 2 }}>17 members · 11 online</Text>
            </View>
            <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.glassHi, borderWidth: 1, borderColor: C.glassBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="more-horizontal" size={18} color={C.subtle} />
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
                { l: 'Attendance', v: '23', i: 'check-circle' as const },
                { l: 'People', v: '17', i: 'users' as const },
                { l: 'Events', v: '3', i: 'calendar' as const },
                { l: 'Bots', v: null as any, i: 'cpu' as const },
              ].map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.glassHi, borderWidth: 1, borderColor: C.glassBorder }}>
                  <Feather name={s.i} size={13} color={C.accentInk} />
                  <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, fontWeight: '600' }}>{s.l}</Text>
                  {s.v && <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, fontWeight: '700' }}>{s.v}</Text>}
                </View>
              ))}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18,
              shadowColor: C.accent, shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
            }}>
              <Feather name="message-circle" size={32} color={C.accent} />
            </View>
            <Text style={{ fontFamily: F.serif, fontSize: 28, color: C.ink, fontWeight: '400', marginBottom: 8, letterSpacing: -0.6 }}>No messages yet</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.subtle, textAlign: 'center' }}>Start a conversation with {activeGroup.name}.</Text>
          </ScrollView>

          <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: C.ruleSoft, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glassHi, borderWidth: 1, borderColor: C.glassBorder }}>
              <Feather name="paperclip" size={16} color={C.subtle} />
            </Pressable>
            <View style={{ flex: 1, backgroundColor: C.glassHi, borderRadius: 20, paddingHorizontal: 14, height: 40, justifyContent: 'center', borderWidth: 1, borderColor: C.glassBorder }}>
              <TextInput placeholder={`Message ${activeChannel.name}`} placeholderTextColor={C.faint} style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, outlineWidth: 0 as any }} />
            </View>
            <Pressable style={{
              width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
              shadowColor: C.accent, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
            }}>
              <Feather name="arrow-up" size={18} color={C.base} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
