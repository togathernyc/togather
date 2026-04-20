import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Campfire Circle" — dark lantern glow · responsive
const C = {
  night: '#0B1220',
  deeper: '#070B14',
  panel: '#111A2A',
  panelLight: '#16213A',
  amber: '#F2A65A',
  amberDim: '#C38246',
  ember: '#E87A47',
  cream: '#F3E5CF',
  muted: '#8A7A66',
  sage: '#8AA596',
  plum: '#B97C9E',
  unreadBg: 'rgba(242,166,90,0.10)',
  unreadBgSub: 'rgba(242,166,90,0.14)',
  unreadBorder: 'rgba(242,166,90,0.38)',
};

const F = {
  display: '"Cormorant Garamond", "Times New Roman", serif',
  body: '"Work Sans", system-ui, sans-serif',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(138,165,150,0.16)', color: C.sage },
  Teams: { bg: 'rgba(185,124,158,0.18)', color: C.plum },
  Classes: { bg: 'rgba(242,166,90,0.16)', color: C.amber },
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Work+Sans:wght@300;400;500;700&display=swap';
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .campfire-bg {
        background:
          radial-gradient(ellipse 700px 500px at 30% 0%, rgba(242,166,90,0.10) 0%, transparent 55%),
          radial-gradient(ellipse 900px 700px at 85% 100%, rgba(185,124,158,0.12) 0%, transparent 55%),
          ${C.night};
      }
      .lantern { box-shadow: 0 0 30px rgba(242,166,90,0.35), 0 0 60px rgba(232,122,71,0.15); }
      @keyframes flicker { 0%,100% { opacity: 1; } 50% { opacity: 0.78; } }
      .flicker { animation: flicker 3.2s ease-in-out infinite; }
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

function Avatar({ g, lit }: { g: Group; lit: boolean }) {
  return (
    <View
      // @ts-expect-error - RN web style
      className={lit ? 'lantern flicker' : ''}
      style={{ position: 'relative', marginRight: 12 }}
    >
      <Image source={{ uri: g.image }} style={{
        width: 56, height: 56, borderRadius: 28,
        borderWidth: 1, borderColor: lit ? C.amber : 'rgba(255,255,255,0.1)',
        opacity: lit ? 1 : 0.55,
      }} />
      {g.userRole === 'leader' && (
        <View style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, borderWidth: 2, borderColor: C.deeper, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={11} color={C.deeper} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: 'rgba(255,255,255,0.08)', color: C.cream };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: s.bg }}>
      <Text style={{ fontFamily: F.body, fontSize: 10, fontWeight: '700', color: s.color, letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ backgroundColor: active ? C.panel : 'transparent' }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 14,
        backgroundColor: hasUnread ? C.unreadBg : 'transparent',
      }}>
        <Avatar g={g} lit={hasUnread} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 20, color: C.cream, flex: 1, marginRight: 8, letterSpacing: -0.3, fontWeight: hasUnread ? '700' : '500' }}>
              {g.name}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.display, fontStyle: 'italic', fontSize: 14, flex: 1, marginRight: 8,
              color: (multi ? hasUnread : main.unreadCount > 0) ? C.cream : C.muted,
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.body, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
                color: main.unreadCount > 0 ? C.amber : C.muted,
                fontWeight: main.unreadCount > 0 ? '700' : '400',
              }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {total > 0 && (
          <View
            // @ts-expect-error - RN web style
            className="lantern"
            style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 10 }}
          >
            <Text style={{ fontFamily: F.body, color: C.deeper, fontSize: 11, fontWeight: '700' }}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const cur = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', paddingLeft: 16 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: 'rgba(242,166,90,0.3)' }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: 'rgba(242,166,90,0.3)' }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 16, marginBottom: 8, marginTop: 4,
              borderWidth: 1,
              backgroundColor: cur ? C.unreadBgSub : C.panel,
              borderColor: cur ? C.unreadBorder : 'transparent',
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 14, color: C.cream, marginRight: 8, fontWeight: '600' }}>{ch.name}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.display, fontStyle: 'italic', fontSize: 13, color: cur ? C.cream : C.muted }}>{preview(ch)}</Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.body, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', marginLeft: 8, color: cur ? C.amber : C.muted, fontWeight: cur ? '700' : '400' }}>{ch.lastWhen}</Text>
              )}
              {cur && (
                <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.body, color: C.deeper, fontSize: 10, fontWeight: '700' }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design5() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <DesktopView /> : <MobileView />;
}

function MobileView() {
  return (
    <View
      // @ts-expect-error - RN web style
      className="campfire-bg"
      style={{ flex: 1 }}
    >
      <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 14 }}>
        <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 32, color: C.cream, fontWeight: '700', letterSpacing: -0.5 }}>Inbox</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', paddingVertical: 10, paddingBottom: 22, backgroundColor: C.deeper, borderTopWidth: 1, borderTopColor: 'rgba(242,166,90,0.2)' }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{ flex: 1, alignItems: 'center', gap: 3, paddingTop: 6 }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.amber : C.muted} />
            <Text style={{ fontFamily: F.body, fontSize: 10, letterSpacing: 2, color: t.active ? C.cream : C.muted, textTransform: 'uppercase', fontWeight: t.active ? '700' : '400' }}>{t.label}</Text>
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
      className="campfire-bg"
      style={{ flex: 1, flexDirection: 'row' }}
    >
      <View style={{ width: 80, backgroundColor: C.deeper, alignItems: 'center', paddingTop: 28, gap: 8, borderRightWidth: 1, borderRightColor: 'rgba(242,166,90,0.12)' }}>
        <View
          // @ts-expect-error - RN web style
          className="flicker"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.ember, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
        >
          <Text style={{ fontFamily: F.display, color: C.deeper, fontWeight: '700', fontSize: 18 }}>T</Text>
        </View>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            width: 60, paddingVertical: 10, alignItems: 'center', gap: 3, borderRadius: 10,
            backgroundColor: t.active ? 'rgba(242,166,90,0.12)' : 'transparent',
            borderWidth: 1, borderColor: t.active ? 'rgba(242,166,90,0.4)' : 'transparent',
          }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.amber : C.muted} />
            <Text style={{ fontFamily: F.body, fontSize: 9, letterSpacing: 2, color: t.active ? C.cream : C.muted, textTransform: 'uppercase' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 380, borderRightWidth: 1, borderRightColor: 'rgba(242,166,90,0.1)' }}>
        <View style={{ paddingHorizontal: 22, paddingTop: 28, paddingBottom: 16 }}>
          <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 32, color: C.cream, fontWeight: '700', letterSpacing: -0.5 }}>Inbox</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(242,166,90,0.12)', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            // @ts-expect-error - RN web style
            className="lantern flicker"
            style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.amber, overflow: 'hidden' }}
          >
            <Image source={{ uri: g.image }} style={{ width: 44, height: 44, borderRadius: 22 }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 24, color: C.cream, fontWeight: '700' }}>{g.name}</Text>
              <TypeBadge label={g.groupTypeName} />
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: C.amberDim, marginTop: 2 }}>17 members · 11 online</Text>
          </View>
          <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 24, paddingTop: 14, gap: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(242,166,90,0.12)', alignItems: 'center' }}>
          {[{ l: 'General', active: true }, { l: 'Leaders' }].map((t, i) => (
            <View key={i} style={{ paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.active ? C.amber : 'transparent' }}>
              <Text style={{ fontFamily: F.display, fontSize: 16, fontStyle: t.active ? 'normal' : 'italic', color: t.active ? C.cream : C.muted, fontWeight: t.active ? '700' : '500' }}>{t.l}</Text>
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
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
                backgroundColor: C.panel, borderWidth: 1, borderColor: 'rgba(242,166,90,0.2)',
              }}>
                <Ionicons name={s.i} size={13} color={C.amberDim} />
                <Text style={{ fontFamily: F.body, fontSize: 11, color: C.cream, fontWeight: '600' }}>{s.l}</Text>
                {s.v && <Text style={{ fontFamily: F.body, fontSize: 11, color: C.amber, fontWeight: '700' }}>{s.v}</Text>}
              </View>
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View
            // @ts-expect-error - RN web style
            className="lantern flicker"
            style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.ember, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.amber, marginBottom: 20 }}
          >
            <Ionicons name="chatbubbles-outline" size={36} color={C.deeper} />
          </View>
          <Text style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 28, color: C.cream, fontWeight: '700' }}>No messages yet</Text>
          <Text style={{ fontFamily: F.display, fontSize: 16, color: C.amberDim, marginTop: 8, textAlign: 'center' }}>Start a conversation with {g.name}.</Text>
        </ScrollView>

        <View style={{ padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(242,166,90,0.12)' }}>
          <Pressable style={{
            width: 40, height: 40, borderRadius: 20,
            borderWidth: 1, borderColor: 'rgba(242,166,90,0.3)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="add" size={22} color={C.amber} />
          </Pressable>
          <View style={{
            flex: 1, backgroundColor: C.panel, borderRadius: 20,
            borderWidth: 1, borderColor: 'rgba(242,166,90,0.15)',
            paddingHorizontal: 16, height: 40, justifyContent: 'center',
          }}>
            <TextInput
              placeholder={`Message ${ch.name}`}
              placeholderTextColor={C.muted}
              style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 15, color: C.cream, outlineWidth: 0 as any }}
            />
          </View>
          <Pressable style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={20} color={C.deeper} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
