import { isOptimisticMessageId, resolveReplyPreview } from "../replyPreview";

describe("isOptimisticMessageId", () => {
  it("is true for the synthetic optimistic ids from useSendMessage", () => {
    // `optimistic-${Date.now()}-${counter}` — a just-sent message the server
    // query can't resolve yet.
    expect(isOptimisticMessageId("optimistic-1710000000000-3")).toBe(true);
  });

  it("is false for a real Convex message id", () => {
    expect(isOptimisticMessageId("k17abcdef0123456789")).toBe(false);
  });

  it("is false for null/undefined (no reply in progress)", () => {
    expect(isOptimisticMessageId(null)).toBe(false);
    expect(isOptimisticMessageId(undefined)).toBe(false);
  });
});

describe("resolveReplyPreview", () => {
  it("uses the local snapshot when the parent can't be fetched (optimistic target)", () => {
    // The optimistic path passes `null` to useParentMessage, so `fetched` is
    // null and the banner must fall back to the locally-captured values —
    // otherwise it goes blank, the exact bug this fixes.
    expect(
      resolveReplyPreview(null, { content: "See you at 7", senderName: "Dara P" }),
    ).toEqual({ content: "See you at 7", senderName: "Dara P" });
  });

  it("prefers the fetched parent over the local snapshot for real messages", () => {
    // A real message resolves via the server query; its (possibly edited)
    // content should override the stale local snapshot.
    expect(
      resolveReplyPreview(
        { content: "Edited: see you at 7:30", senderName: "Dara Peters" },
        { content: "See you at 7", senderName: "Dara P" },
      ),
    ).toEqual({ content: "Edited: see you at 7:30", senderName: "Dara Peters" });
  });

  it("never returns undefined — empty strings when nothing is available", () => {
    expect(resolveReplyPreview(null, null)).toEqual({ content: "", senderName: "" });
    expect(resolveReplyPreview(undefined, undefined)).toEqual({
      content: "",
      senderName: "",
    });
  });

  it("fills each field independently (fetched name + local content)", () => {
    expect(
      resolveReplyPreview({ senderName: "Dara" }, { content: "hi" }),
    ).toEqual({ content: "hi", senderName: "Dara" });
  });
});
