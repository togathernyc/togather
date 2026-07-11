import {
  buildThreadAwareTimeline,
  shouldFloatGhost,
  type ThreadTimelineMessage,
} from "../threadTimeline";

/**
 * The chat orders top-level messages by `createdAt` so replying no longer moves
 * the real message. Instead, each replied-to message floats a content-free
 * "ghost" pointer at its `lastActivityAt` slot. These tests pin down that
 * derivation: the real message stays put, and exactly one ghost is emitted per
 * bumped thread at the right position.
 */

type Msg = ThreadTimelineMessage & { id: string; senderId?: string };

const msg = (overrides: Partial<Msg> & { id: string; createdAt: number }): Msg => ({
  isDeleted: false,
  ...overrides,
});

// Compact view of the derived timeline for readable assertions.
const shape = (entries: ReturnType<typeof buildThreadAwareTimeline<Msg>>) =>
  entries.map((e) => `${e.kind === "ghost" ? "ghost" : "msg"}:${e.message.id}`);

describe("shouldFloatGhost", () => {
  it("floats a ghost when a message has replies and was bumped", () => {
    expect(
      shouldFloatGhost({ createdAt: 100, isDeleted: false, threadReplyCount: 2, lastActivityAt: 300 }),
    ).toBe(true);
  });

  it("does not float a ghost when there are no replies", () => {
    expect(
      shouldFloatGhost({ createdAt: 100, isDeleted: false, threadReplyCount: 0, lastActivityAt: 300 }),
    ).toBe(false);
    expect(shouldFloatGhost({ createdAt: 100, isDeleted: false })).toBe(false);
  });

  it("does not float a ghost when lastActivityAt equals createdAt (never bumped)", () => {
    expect(
      shouldFloatGhost({ createdAt: 100, isDeleted: false, threadReplyCount: 1, lastActivityAt: 100 }),
    ).toBe(false);
  });

  it("does not float a ghost for a deleted original", () => {
    expect(
      shouldFloatGhost({ createdAt: 100, isDeleted: true, threadReplyCount: 3, lastActivityAt: 300 }),
    ).toBe(false);
  });
});

describe("buildThreadAwareTimeline", () => {
  it("keeps a replied-to message in its original position and floats one ghost at the bottom", () => {
    // A (created first, then replied to → bumped to t=300), B (created at t=200).
    const a = msg({ id: "A", createdAt: 100, threadReplyCount: 2, lastActivityAt: 300 });
    const b = msg({ id: "B", createdAt: 200 });

    const timeline = buildThreadAwareTimeline([a, b]);

    // A stays before B (createdAt order), and A's ghost floats after B (t=300).
    expect(shape(timeline)).toEqual(["msg:A", "msg:B", "ghost:A"]);
  });

  it("emits exactly one ghost per thread no matter how many replies", () => {
    // Multiple replies only bump lastActivityAt / threadReplyCount on the one
    // parent, so there is still a single ghost.
    const a = msg({ id: "A", createdAt: 100, threadReplyCount: 5, lastActivityAt: 900 });
    const b = msg({ id: "B", createdAt: 200 });

    const timeline = buildThreadAwareTimeline([a, b]);

    expect(timeline.filter((e) => e.kind === "ghost")).toHaveLength(1);
    expect(shape(timeline)).toEqual(["msg:A", "msg:B", "ghost:A"]);
  });

  it("positions each ghost independently at its own lastActivityAt", () => {
    // A replied to at t=250 (between B and C), C replied to at t=500 (last).
    const a = msg({ id: "A", createdAt: 100, threadReplyCount: 1, lastActivityAt: 250 });
    const b = msg({ id: "B", createdAt: 200 });
    const c = msg({ id: "C", createdAt: 300, threadReplyCount: 1, lastActivityAt: 500 });

    const timeline = buildThreadAwareTimeline([a, b, c]);

    expect(shape(timeline)).toEqual([
      "msg:A",
      "msg:B",
      "ghost:A",
      "msg:C",
      "ghost:C",
    ]);
  });

  it("produces no ghosts when nothing has been replied to", () => {
    const a = msg({ id: "A", createdAt: 100 });
    const b = msg({ id: "B", createdAt: 200 });

    const timeline = buildThreadAwareTimeline([a, b]);

    expect(shape(timeline)).toEqual(["msg:A", "msg:B"]);
  });

  it("does not float a ghost for a deleted original", () => {
    const a = msg({ id: "A", createdAt: 100, isDeleted: true, threadReplyCount: 2, lastActivityAt: 300 });
    const b = msg({ id: "B", createdAt: 200 });

    const timeline = buildThreadAwareTimeline([a, b]);

    expect(shape(timeline)).toEqual(["msg:A", "msg:B"]);
  });

  it("orders a real message before a ghost sharing the same timestamp", () => {
    // A's bump lands exactly on C's createdAt — the real message wins the slot.
    const a = msg({ id: "A", createdAt: 100, threadReplyCount: 1, lastActivityAt: 300 });
    const c = msg({ id: "C", createdAt: 300 });

    const timeline = buildThreadAwareTimeline([a, c]);

    expect(shape(timeline)).toEqual(["msg:A", "msg:C", "ghost:A"]);
  });
});
