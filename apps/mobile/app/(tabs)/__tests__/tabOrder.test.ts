/**
 * Tab ORDER guard for `app/(tabs)/_layout.tsx`.
 *
 * Visible tab order in React Navigation is JSX child order, so it is a
 * property of the source layout, not of any rendered component — and
 * rendering the real layout means standing up an entire Expo Router
 * navigation container. This reads the layout source instead, the same
 * static approach `scripts/check-navigator-screens.js` takes to the sibling
 * invariant.
 *
 * The order it pins (owner directive, 2026-07-29):
 *
 *   flag-on : Groups · Events · Chats · Prayer · You   (Chats dead-centre)
 *             Groups · Events · Chats · You            (prayer-off community)
 *   flag-off: Groups · Events · Inbox · Admin · Profile (unchanged)
 *
 * `Chats` is the shared `chatTabScreen` element, placed at one of two JSX
 * positions depending on the flag — that's what the two marker regexes below
 * are looking for.
 */
import fs from 'fs';
import path from 'path';

const LAYOUT = path.join(__dirname, '..', '_layout.tsx');

/** Screen registrations + the two conditional `chatTabScreen` placements, in source order. */
function readSlots(): string[] {
  const source = fs
    .readFileSync(LAYOUT, 'utf8')
    // Drop comments so the prose in them can't match the patterns below.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const slots: { index: number; label: string }[] = [];
  const screenRe = /<\s*Tabs\s*\.\s*Screen\s+name="([a-zA-Z-]+)"/g;
  for (let m = screenRe.exec(source); m; m = screenRe.exec(source)) {
    slots.push({ index: m.index, label: m[1] });
  }
  const waChatRe = /\{\s*showWhatsappShell\s*&&\s*chatTabScreen\s*\}/g;
  for (let m = waChatRe.exec(source); m; m = waChatRe.exec(source)) {
    slots.push({ index: m.index, label: 'chat@wa' });
  }
  const legacyChatRe = /\{\s*!showWhatsappShell\s*&&\s*chatTabScreen\s*\}/g;
  for (let m = legacyChatRe.exec(source); m; m = legacyChatRe.exec(source)) {
    slots.push({ index: m.index, label: 'chat@legacy' });
  }
  return slots.sort((a, b) => a.index - b.index).map((s) => s.label);
}

describe('(tabs)/_layout tab order', () => {
  const slots = readSlots();

  it('registers exactly one flag-on and one flag-off Chats placement', () => {
    expect(slots.filter((s) => s === 'chat@wa')).toHaveLength(1);
    expect(slots.filter((s) => s === 'chat@legacy')).toHaveLength(1);
  });

  it('puts Chats dead-centre of the flag-on island: Groups, Events, Chats, Prayer, You', () => {
    const flagOnVisible = slots.filter((s) =>
      ['search', 'events', 'chat@wa', 'prayer', 'profile'].includes(s)
    );
    expect(flagOnVisible).toEqual([
      'search', // "Groups"
      'events',
      'chat@wa', // "Chats"
      'prayer',
      'profile', // "You"
    ]);
    // …and the centre still holds for a prayer-off community (4 tabs).
    expect(flagOnVisible.filter((s) => s !== 'prayer')).toEqual([
      'search',
      'events',
      'chat@wa',
      'profile',
    ]);
  });

  it('leaves the flag-off order untouched: Groups, Events, Inbox, Admin, Profile', () => {
    const flagOffVisible = slots.filter((s) =>
      ['search', 'events', 'chat@legacy', 'admin', 'profile'].includes(s)
    );
    expect(flagOffVisible).toEqual([
      'search',
      'events',
      'chat@legacy',
      'admin',
      'profile',
    ]);
  });

  it('keeps Groups (the `search` route) tab-visible under the whatsapp shell', () => {
    const source = fs.readFileSync(LAYOUT, 'utf8');
    const searchBlock = source.slice(
      source.indexOf('name="search"'),
      source.indexOf('name="events"')
    );
    // Serving mode is still the only thing that hides it.
    expect(searchBlock).toContain("href: inServingMode ? null : '/(tabs)/search'");
    expect(searchBlock).not.toContain('showWhatsappShell ? null');
  });
});
