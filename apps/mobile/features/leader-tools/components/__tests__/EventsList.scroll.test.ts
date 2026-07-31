/**
 * The Attendance event picker centers the selected card. The arithmetic has to
 * agree with the card metrics (width 132 + gap 12, 16pt screen margin) — the
 * previous version used a stale 152pt literal, which centered on nothing.
 */
import { eventCardScrollOffset } from "../EventsList";

const CARD_WIDTH = 132;
const CARD_GAP = 12;
const MARGIN = 16;
const VIEWPORT = 390;

/** Where the centered card's midpoint lands on screen after scrolling. */
function cardMidpointOnScreen(index: number, viewportWidth: number): number {
  const contentCenter = MARGIN + index * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2;
  return contentCenter - eventCardScrollOffset(index, viewportWidth);
}

describe("eventCardScrollOffset", () => {
  it("does not scroll past the leading edge for early cards", () => {
    // Card 0 sits well within the first viewport — scrolling would push the
    // strip off its 16pt margin.
    expect(eventCardScrollOffset(0, VIEWPORT)).toBe(0);
  });

  it("centers a card that is far enough along the strip", () => {
    expect(cardMidpointOnScreen(5, VIEWPORT)).toBeCloseTo(VIEWPORT / 2);
    expect(cardMidpointOnScreen(12, VIEWPORT)).toBeCloseTo(VIEWPORT / 2);
  });

  it("advances by exactly one card pitch per index once centering kicks in", () => {
    const a = eventCardScrollOffset(6, VIEWPORT);
    const b = eventCardScrollOffset(7, VIEWPORT);
    expect(b - a).toBe(CARD_WIDTH + CARD_GAP);
  });

  it("never returns a negative offset", () => {
    expect(eventCardScrollOffset(0, 1200)).toBe(0);
    expect(eventCardScrollOffset(2, 1200)).toBe(0);
  });
});
