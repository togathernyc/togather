import { REACTIONS } from '../MessageActionsOverlay';

/**
 * The chat reaction bar is a single fixed list shared by both the
 * press-and-hold reaction bar on chat messages and the event-comment
 * reaction picker (EventComment.tsx). These tests lock in the contents so
 * an accidental reorder/removal — or a duplicate emoji — is caught early.
 */
describe('chat REACTIONS list', () => {
  it('includes a Bible (book) reaction next to pray', () => {
    const bible = REACTIONS.find((r) => r.emoji === '📖');
    expect(bible).toEqual({ type: 'bible', emoji: '📖' });

    // 📖 sits directly after 🙏 so the two faith reactions stay together.
    const prayIndex = REACTIONS.findIndex((r) => r.emoji === '🙏');
    const bibleIndex = REACTIONS.findIndex((r) => r.emoji === '📖');
    expect(bibleIndex).toBe(prayIndex + 1);
  });

  it('has no duplicate emojis or types', () => {
    const emojis = REACTIONS.map((r) => r.emoji);
    const types = REACTIONS.map((r) => r.type);
    expect(new Set(emojis).size).toBe(emojis.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it('preserves the existing reactions', () => {
    const emojis = REACTIONS.map((r) => r.emoji);
    expect(emojis).toEqual([
      '👍',
      '❤️',
      '😂',
      '‼️',
      '😮',
      '😢',
      '🥹',
      '🙏',
      '📖',
      '🔥',
      '👏',
      '🎉',
      '💯',
      '👀',
      '😍',
    ]);
  });
});
