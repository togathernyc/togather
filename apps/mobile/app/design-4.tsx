import React, { useEffect } from 'react';
import { Platform, ScrollView, View, Text, Pressable, TextInput, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// "Stoop Night" — 70s block party · responsive
const C = {
  cream: '#F1E4C6',
  mustard: '#E8A82B',
  orange: '#D86024',
  rust: '#A93717',
  olive: '#5B6A2D',
  brown: '#5B3A1C',
  ink: '#221712',
  sky: '#C8D6D1',
  unreadBg: 'rgba(216,96,36,0.10)',
  unreadBgSub: 'rgba(216,96,36,0.16)',
  unreadBorder: 'rgba(216,96,36,0.34)',
};

const F = {
  display: '"Archivo Black", "Arial Black", sans-serif',
  serif: '"Fraunces", Georgia, serif',
  mono: '"DM Mono", "Courier New", monospace',
  sans: '"DM Sans", system-ui, sans-serif',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  'Small Groups': { bg: 'rgba(91,106,45,0.18)', color: C.olive },
  Teams: { bg: 'rgba(232,168,43,0.22)', color: C.rust },
  Classes: { bg: 'rgba(216,96,36,0.18)', color: C.orange },
};

function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Fraunces:ital,wght@0,400;0,700;1,500&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap';
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .noise::after {
        content: ''; position: absolute; inset: 0; pointer-events: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.15'/></svg>");
        mix-blend-mode: multiply;
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

function Avatar({ g }: { g: Group }) {
  return (
    <View style={{ position: 'relative', marginRight: 12 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28,
        borderWidth: 3, borderColor: C.ink, overflow: 'hidden',
        // @ts-expect-error - RN web style
        boxShadow: `3px 3px 0 ${C.ink}`,
      }}>
        <Image source={{ uri: g.image }} style={{ width: 50, height: 50, borderRadius: 25 }} />
      </View>
      {g.userRole === 'leader' && (
        <View style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: C.orange, borderWidth: 2, borderColor: C.ink,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="shield" size={11} color={C.cream} />
        </View>
      )}
    </View>
  );
}

function TypeBadge({ label }: { label: string }) {
  const s = TYPE_COLORS[label] || { bg: 'rgba(0,0,0,0.1)', color: C.ink };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: s.bg, borderWidth: 1, borderColor: C.ink }}>
      <Text style={{ fontFamily: F.display, fontSize: 9, color: s.color, letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</Text>
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
    <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
      <Pressable style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 12,
        backgroundColor: hasUnread ? C.unreadBg : (active ? 'rgba(232,168,43,0.16)' : C.cream),
        borderWidth: 3, borderColor: C.ink, borderRadius: 14,
        // @ts-expect-error - RN web style
        boxShadow: `4px 4px 0 ${C.ink}`,
      }}>
        <Avatar g={g} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 18, color: C.ink, flex: 1, marginRight: 8, letterSpacing: -0.5 }}>
              {g.name.toUpperCase()}
            </Text>
            <TypeBadge label={g.groupTypeName} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text numberOfLines={1} style={{
              fontFamily: F.serif, fontStyle: 'italic', fontSize: 14, flex: 1, marginRight: 8,
              color: (multi ? hasUnread : main.unreadCount > 0) ? C.ink : C.brown,
              fontWeight: (multi ? hasUnread : main.unreadCount > 0) ? '700' : '400',
            }}>{preview(main)}</Text>
            {main.lastWhen && (
              <Text style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
                color: main.unreadCount > 0 ? C.rust : C.brown,
                fontWeight: main.unreadCount > 0 ? '700' : '400',
              }}>{main.lastWhen}</Text>
            )}
          </View>
        </View>
        {total > 0 && (
          <View style={{
            minWidth: 26, height: 26, borderRadius: 13, backgroundColor: C.ink,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, marginLeft: 10,
            borderWidth: 2, borderColor: C.cream,
          }}>
            <Text style={{ fontFamily: F.display, color: C.mustard, fontSize: 11 }}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      {secondary.map((ch) => {
        const cur = ch.unreadCount > 0;
        return (
          <View key={ch._id} style={{ flexDirection: 'row', paddingLeft: 16, marginTop: 6 }}>
            <View style={{ width: 40 }}>
              <View style={{ position: 'absolute', left: 28, top: 0, width: 1.5, height: 20, backgroundColor: C.ink }} />
              <View style={{ position: 'absolute', left: 28, top: 20, width: 12, height: 1.5, backgroundColor: C.ink }} />
            </View>
            <Pressable style={{
              flex: 1, flexDirection: 'row', alignItems: 'center',
              borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
              marginRight: 0, marginBottom: 4, marginTop: 4,
              borderWidth: 2, borderColor: cur ? C.orange : C.ink,
              backgroundColor: cur ? C.unreadBgSub : C.cream,
              // @ts-expect-error - RN web style
              boxShadow: `2px 2px 0 ${C.ink}`,
            }}>
              <Text style={{ fontFamily: F.display, fontSize: 13, color: C.ink, marginRight: 8, letterSpacing: 1 }}>{ch.name.toUpperCase()}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.serif, fontStyle: 'italic', fontSize: 13, color: cur ? C.ink : C.brown }}>{preview(ch)}</Text>
              {ch.lastWhen && (
                <Text style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginLeft: 8, color: cur ? C.rust : C.brown, fontWeight: cur ? '700' : '400' }}>{ch.lastWhen}</Text>
              )}
              {cur && (
                <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginLeft: 8 }}>
                  <Text style={{ fontFamily: F.display, color: C.mustard, fontSize: 10 }}>{ch.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export default function Design4() {
  useWebFonts();
  const { width } = useWindowDimensions();
  return width >= 960 ? <DesktopView /> : <MobileView />;
}

function MobileView() {
  return (
    <View
      // @ts-expect-error - RN web style
      className="noise"
      style={{ flex: 1, backgroundColor: C.cream }}
    >
      <View style={{ paddingHorizontal: 22, paddingTop: 56, paddingBottom: 14 }}>
        <Text style={{ fontFamily: F.display, fontSize: 28, color: C.ink, letterSpacing: -0.8 }}>INBOX.</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {groups.map((g) => <GroupRow key={g._id} g={g} />)}
      </ScrollView>
      <View style={{
        flexDirection: 'row', backgroundColor: C.ink,
        paddingVertical: 10, paddingBottom: 22,
      }}>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            flex: 1, alignItems: 'center', gap: 3, paddingTop: 6,
          }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={22} color={t.active ? C.mustard : C.cream} />
            <Text style={{ fontFamily: F.display, fontSize: 10, color: t.active ? C.mustard : C.cream, letterSpacing: 2 }}>{t.label.toUpperCase()}</Text>
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
      className="noise"
      style={{ flex: 1, flexDirection: 'row', backgroundColor: C.cream }}
    >
      <View style={{ width: 88, backgroundColor: C.ink, alignItems: 'center', paddingTop: 24, gap: 10 }}>
        <View style={{ backgroundColor: C.mustard, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.cream, marginBottom: 10 }}>
          <Text style={{ fontFamily: F.display, color: C.ink, fontSize: 20 }}>T</Text>
        </View>
        {tabs.map((t, i) => (
          <Pressable key={i} style={{
            width: 64, paddingVertical: 10, borderRadius: 12, alignItems: 'center', gap: 3,
            backgroundColor: t.active ? C.mustard : 'transparent',
            borderWidth: t.active ? 2 : 0, borderColor: C.cream,
          }}>
            <Ionicons name={(t.active ? t.activeIcon : t.icon) as any} size={20} color={t.active ? C.ink : C.cream} />
            <Text style={{ fontFamily: F.display, fontSize: 8, color: t.active ? C.ink : C.cream, letterSpacing: 1.5 }}>{t.label.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ width: 400 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }}>
          <Text style={{ fontFamily: F.display, fontSize: 32, color: C.ink, letterSpacing: -1 }}>INBOX.</Text>
        </View>
        <ScrollView>
          {groups.map((g, i) => <GroupRow key={g._id} g={g} active={i === 0} />)}
        </ScrollView>
      </View>

      <View style={{ flex: 1, padding: 16, paddingLeft: 8 }}>
        <View style={{
          flex: 1, backgroundColor: C.ink, borderRadius: 22,
          borderWidth: 3, borderColor: C.ink,
        }}>
          <View style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', borderWidth: 3, borderColor: C.cream }}>
              <Image source={{ uri: g.image }} style={{ width: 42, height: 42, borderRadius: 21 }} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: F.display, fontSize: 24, color: C.cream, letterSpacing: -0.6 }}>{g.name.toUpperCase()}</Text>
                <TypeBadge label={g.groupTypeName} />
              </View>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.sky, letterSpacing: 1, marginTop: 2 }}>17 MEMBERS · 11 ONLINE</Text>
            </View>
            <Pressable style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="ellipsis-horizontal" size={20} color={C.cream} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}>
            {[{ l: 'GENERAL', active: true }, { l: 'LEADERS' }].map((t, i) => (
              <Pressable key={i} style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginBottom: 10,
                backgroundColor: t.active ? C.mustard : 'transparent',
                borderWidth: 2, borderColor: t.active ? C.mustard : 'rgba(255,255,255,0.3)',
              }}>
                <Text style={{ fontFamily: F.display, fontSize: 11, color: t.active ? C.ink : C.cream, letterSpacing: 1.5 }}>{t.l}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {[
                { l: 'Attendance', v: '23', i: 'checkmark-circle-outline' as const },
                { l: 'People', v: '17', i: 'people-outline' as const },
                { l: 'Events', v: '3', i: 'calendar-outline' as const },
                { l: 'Bots', v: null, i: 'hardware-chip-outline' as const },
              ].map((s, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                  backgroundColor: C.orange, borderWidth: 2, borderColor: C.cream,
                }}>
                  <Ionicons name={s.i} size={12} color={C.cream} />
                  <Text style={{ fontFamily: F.display, fontSize: 9, color: C.cream, letterSpacing: 1 }}>{s.l.toUpperCase()}</Text>
                  {s.v && <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.cream, fontWeight: '700' }}>{s.v}</Text>}
                </View>
              ))}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <View style={{
              width: 100, height: 100, borderRadius: 50, backgroundColor: C.mustard,
              borderWidth: 3, borderColor: C.cream, alignItems: 'center', justifyContent: 'center',
              // @ts-expect-error - RN web style
              boxShadow: `4px 4px 0 rgba(0,0,0,0.4)`,
            }}>
              <Ionicons name="chatbubbles-outline" size={44} color={C.ink} />
            </View>
            <Text style={{ fontFamily: F.display, fontSize: 32, color: C.mustard, letterSpacing: -1, marginTop: 22 }}>NO MESSAGES YET</Text>
            <Text style={{ fontFamily: F.serif, fontStyle: 'italic', fontSize: 16, color: C.cream, marginTop: 8, textAlign: 'center' }}>Start a conversation with {g.name}.</Text>
          </ScrollView>

          <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' }}>
            <Pressable style={{
              width: 40, height: 40, borderRadius: 20, backgroundColor: C.mustard,
              alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.cream,
            }}>
              <Ionicons name="add" size={20} color={C.ink} />
            </Pressable>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, height: 40, justifyContent: 'center' }}>
              <TextInput
                placeholder={`Message ${ch.name}`}
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={{ fontFamily: F.sans, fontSize: 14, color: C.cream, outlineWidth: 0 as any }}
              />
            </View>
            <Pressable style={{
              width: 40, height: 40, borderRadius: 20, backgroundColor: C.orange,
              alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.cream,
            }}>
              <Ionicons name="arrow-up" size={20} color={C.cream} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
