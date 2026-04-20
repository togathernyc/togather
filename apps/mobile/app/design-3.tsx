import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Potluck Board" — cork bulletin collage · responsive
const C = {
  cork: '#B78450',
  corkDark: '#8E5F33',
  polaroid: '#FBF8F1',
  ink: '#2A241C',
  red: '#D64640',
  yellow: '#F5C64A',
  green: '#7FA661',
  blue: '#4E7AA6',
  purple: '#B978D6',
  muted: '#7a6b52',
  unreadBg: 'rgba(214,70,64,0.10)',
  unreadBgSub: 'rgba(214,70,64,0.14)',
  unreadBorder: 'rgba(214,70,64,0.32)',
};

const F = {
  hand: '"Caveat", cursive',
  hand2: '"Kalam", cursive',
  serif: '"Merriweather", Georgia, serif',
  sans: '"Work Sans", system-ui, sans-serif',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(78,122,166,0.15)', color: C.blue },
  Teams: { bg: 'rgba(245,198,74,0.22)', color: '#9A7418' },
  Classes: { bg: 'rgba(185,120,214,0.18)', color: C.purple },
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Kalam:wght@400;700&family=Merriweather:wght@400;700;900&family=Work+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .corkbg {
        background-color: ${C.cork};
        background-image:
          radial-gradient(circle at 20% 30%, rgba(255,255,255,0.06) 0, transparent 2px),
          radial-gradient(circle at 70% 80%, rgba(0,0,0,0.08) 0, transparent 2px),
          radial-gradient(circle at 40% 70%, rgba(255,255,255,0.05) 0, transparent 1.5px),
          radial-gradient(circle at 90% 20%, rgba(0,0,0,0.07) 0, transparent 2px);
        background-size: 8px 8px, 11px 11px, 5px 5px, 13px 13px;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(link); document.head.removeChild(style); };
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

// Polaroid-framed avatar
function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{
        backgroundColor: C.polaroid, padding: 4, paddingBottom: 10,
        transform: [{ rotate: '-2deg' }] as any,
        // @ts-expect-error - RN web style
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      }}>
        <Image source={{ uri: g.image }} style={{ width: 48, height: 48 }} />
      </View>
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: C.red, borderWidth: 2, borderColor: C.polaroid, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color="#fff" />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: 'rgba(42,36,28,0.1)', color: C.ink };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.sans, fontSize: 10, fontWeight: '700', color: s.color, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? 'rgba(251,248,241,0.4)' : 'transparent' }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 8, marginVertical: 4,
        backgroundColor: hasUnread ? C.unreadBg : 'rgba(251,248,241,0.08)',
        borderRadius: 6,
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1, paddingLeft: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.hand, fontSize: 24, fontWeight: '700', color: C.polaroid, flex: 1, marginRight: 8, lineHeight: 26 }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.hand2, fontSize: 14, flex: 1, marginRight: 8,
              color: (multi ? hasUnread : main.unreadCount > 0) ? '#FFF6D8' : 'rgba(251,248,241,0.75)',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.hand2, fontSize: 12,
                color: main.unreadCount > 0 ? C.yellow : 'rgba(251,248,241,0.6)',
                fontWeight: main.unreadCount > 0 ? '700' : '400',
              }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {total > 0 && (
          <View style={{
            minWidth: 24, height: 24, borderRadius: 12, backgroundColor: C.red,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 10,
            transform: [{ rotate: '-6deg' }] as any, borderWidth: 2, borderColor: C.polaroid,
          }}>
            <Text style={{ fontFamily: F.sans, color: 'white', fontSize: 11, fontWeight: '700' }}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const cur = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', paddingLeft: 16 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: 'rgba(251,248,241,0.4)' }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: 'rgba(251,248,241,0.4)' }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 16, marginBottom: 8, marginTop: 4,
              borderWidth: 1,
              backgroundColor: cur ? C.unreadBgSub : 'rgba(251,248,241,0.12)',
              borderColor: cur ? C.unreadBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.hand, fontSize: 18, color: C.polaroid, marginRight: 8 }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.hand2, fontSize: 13, color: cur ? '#FFF6D8' : 'rgba(251,248,241,0.7)' }}>{preview(ch)}</Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.hand2, fontSize: 11, marginLeft: 8, color: cur ? C.yellow : 'rgba(251,248,241,0.55)', fontWeight: cur ? '700' : '400' }}>{ch.lastWhen}</Text>
              )}
              {cur && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.sans, color: 'white', fontSize: 10, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design3() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <DesktopView /> : <MobileView />;
}

function MobileView() {
  return (
    <View
      // @ts-expect-error - RN web style
      className="corkbg"
      style={{ flex: 1 }}
    >
      <View style={{ paddingHorizontal: 18, paddingTop: 56, paddingBottom: 16 }}>
        <Text style={{ fontFamily: F.hand, fontSize: 38, color: C.polaroid, fontWeight: '700', letterSpacing: -0.5 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{
        flexDirection: 'row', paddingVertical: 10, paddingBottom: 22,
        backgroundColor: C.polaroid,
        borderTopWidth: 1, borderTopColor: C.ink,
      }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 3, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.red : C.muted} />
            <Text style={{ fontFamily: F.hand, fontSize: 14, color: t.active ? C.ink : C.muted }}>{t.label}</Text>
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
    <View
      // @ts-expect-error - RN web style
      className="corkbg"
      style={{ flex: 1, flexDirection: 'row' }}
    >
      <View style={{ width: 80, alignItems: 'center', paddingTop: 28, gap: 16 }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: t.active ? C.polaroid : 'rgba(255,248,225,0.2)',
              borderWidth: 2, borderColor: C.ink, borderStyle: t.active ? 'solid' : 'dashed',
              alignItems: 'center', justifyContent: 'center',
              transform: [{ rotate: `${[-3, 2, -2, 3][i]}deg` }] as any,
            }}>
              <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.red : C.polaroid} />
            </View>
            <Text style={{ fontFamily: F.hand, fontSize: 14, color: t.active ? C.polaroid : '#F4E7CB' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 380, paddingTop: 20 }}>
        <View style={{ paddingHorizontal: 18, paddingBottom: 12 }}>
          <Text style={{ fontFamily: F.hand, fontSize: 38, color: C.polaroid, fontWeight: '700' }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, padding: 20 }}>
        <View
          // @ts-expect-error - RN web style
          style={{
            flex: 1, backgroundColor: C.polaroid, borderRadius: 3,
            // @ts-expect-error - RN web style
            boxShadow: '0 8px 18px rgba(0,0,0,0.28), 0 2px 4px rgba(0,0,0,0.22)',
          }}
        >
          <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(42,36,28,0.12)', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ backgroundColor: 'white', padding: 4, paddingBottom: 10, transform: [{ rotate: '-2deg' }] as any,
              // @ts-expect-error - RN web style
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
              <Image source={{ uri: g.image }} style={{ width: 40, height: 40 }} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: F.hand, fontSize: 30, color: C.ink, lineHeight: 32 }}>{g.name}</Text>
                <TypeBadge label={g.groupTypeName} />
              </View>
              <Text style={{ fontFamily: F.hand2, fontSize: 13, color: C.muted, marginTop: 2 }}>17 members · 11 online</Text>
            </View>
            <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', paddingHorizontal: 24, paddingTop: 14, gap: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(42,36,28,0.12)', alignItems: 'center' }}>
            {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
              <View key={i} style={{
                paddingBottom: 10,
                backgroundColor: t.active ? 'rgba(245,198,74,0.45)' : 'transparent',
                paddingHorizontal: 12, paddingTop: 6,
                transform: [{ rotate: `${t.active ? -1 : 1}deg` }] as any,
              }}>
                <Text style={{ fontFamily: F.hand, fontSize: 18, color: C.ink }}>{t.l}</Text>
              </View>
            ))}
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
              {[
                { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const, c: C.red },
                { l: 'People', v: '17', i: 'people-outline' as const, c: C.green },
                { l: 'Events', v: '3', i: 'calendar-outline' as const, c: C.blue },
                { l: 'Bots', v: null, i: 'hardware-chip-outline' as const, c: C.purple },
              ].map((s, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: 'white', borderWidth: 2, borderColor: C.ink,
                  transform: [{ rotate: `${[-2, 1, -1, 2][i]}deg` }] as any,
                }}>
                  <Ionicons name={s.i} size={13} color={s.c} />
                  <Text style={{ fontFamily: F.sans, fontSize: 10, color: s.c, fontWeight: '700', letterSpacing: 1 }}>{s.l.toUpperCase()}</Text>
                  {s.v && <Text style={{ fontFamily: F.hand, fontSize: 16, color: C.ink }}>{s.v}</Text>}
                </View>
              ))}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <Ionicons name="chatbubbles-outline" size={52} color={C.red} style={{ marginBottom: 16 }} />
            <Text style={{ fontFamily: F.hand, fontSize: 42, color: C.ink, lineHeight: 44 }}>No messages yet</Text>
            <Text style={{ fontFamily: F.hand2, fontSize: 15, color: C.muted, marginTop: 8, textAlign: 'center' }}>Start a conversation with {g.name}.</Text>
          </ScrollView>

          <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: 'rgba(42,36,28,0.12)', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color={C.muted} />
            </Pressable>
            <View style={{ flex: 1, backgroundColor: '#FFF6D8', borderRadius: 8, paddingHorizontal: 14, height: 40, justifyContent: 'center', borderWidth: 2, borderColor: C.ink, borderStyle: 'dashed' }}>
              <TextInput
                placeholder={`Message ${ch.name}`}
                placeholderTextColor="#8B7A57"
                style={{ fontFamily: F.hand, fontSize: 18, color: C.ink, outlineWidth: 0 as any }}
              />
            </View>
            <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.ink }}>
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
