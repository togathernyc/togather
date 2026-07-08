/**
 * Unit tests for parseDevRoute — the URL classifier behind the desktop
 * Contribute split view. Guards the three behaviors the layout depends on:
 * highlighting the open conversation, knowing when compose is active, and
 * keeping the split view off the standalone dev tools that share `/dev`.
 */
import { parseDevRoute } from "./devRoute";

describe("parseDevRoute", () => {
  it("treats the list route as a conversation surface with nothing selected", () => {
    expect(parseDevRoute("/dev")).toEqual({
      selectedId: null,
      composing: false,
      isConversationRoute: true,
    });
  });

  it("marks the compose route as composing", () => {
    expect(parseDevRoute("/dev/submit")).toEqual({
      selectedId: null,
      composing: true,
      isConversationRoute: true,
    });
  });

  it("extracts the open conversation id from a /dev/<id> path", () => {
    const id = "j57abc0123456789def";
    expect(parseDevRoute(`/dev/${id}`)).toEqual({
      selectedId: id,
      composing: false,
      isConversationRoute: true,
    });
  });

  it("still resolves the id when the path carries a query or hash", () => {
    const id = "j57abc0123456789def";
    expect(parseDevRoute(`/dev/${id}?from=chat`).selectedId).toBe(id);
    expect(parseDevRoute(`/dev/${id}#top`).selectedId).toBe(id);
  });

  it("keeps standalone dev tools out of the split view", () => {
    for (const path of [
      "/dev/feature-flags",
      "/dev/notifications",
      "/dev/task-reminder-tester",
      "/dev/theme-gallery",
    ]) {
      expect(parseDevRoute(path)).toEqual({
        selectedId: null,
        composing: false,
        isConversationRoute: false,
      });
    }
  });

  it("does not mistake a short non-id segment for a conversation", () => {
    // 'submit' is handled explicitly; any other short slug is a tool route.
    expect(parseDevRoute("/dev/abc").isConversationRoute).toBe(false);
    expect(parseDevRoute("/dev/abc").selectedId).toBeNull();
  });

  it("returns no-split for paths outside /dev", () => {
    expect(parseDevRoute("/inbox").isConversationRoute).toBe(false);
    expect(parseDevRoute("/devil").isConversationRoute).toBe(false);
  });
});
