/**
 * devRoute — pure helpers for classifying a `/dev` pathname.
 *
 * The desktop-web Contribute layout (app/(user)/dev/_layout.tsx) keeps a single
 * persistent sidebar and swaps only the right pane as you move between the list,
 * a conversation, and the compose form. To do that from the URL alone it needs
 * two facts, both derived here so they can be unit-tested without a navigator:
 *
 *  - which conversation (if any) is open, so the sidebar highlights its row, and
 *  - whether the path is a Contribute *conversation* surface at all — the split
 *    view only wraps the list / a conversation / compose. The other standalone
 *    dev tools that also live under `/dev` (feature-flags, theme-gallery, …) are
 *    full-screen and must NOT get the sidebar.
 */
import type { Id } from "@services/api/convex";

// A Convex document id is 16–64 lowercase alphanumerics — the shared guard
// for every contribute surface that takes an id from a URL, so a non-id
// segment (e.g. "submit", "feature-flags") or malformed deep link never
// reaches the Convex queries (which would throw an ArgumentValidationError
// through render).
export const LOOKS_LIKE_CONVEX_ID = /^[a-z0-9]{16,64}$/;

export interface DevRoute {
  /** The open conversation id (for the sidebar row highlight), or null. */
  selectedId: Id<"devBugs"> | null;
  /** True while composing a new conversation (`/dev/submit`). */
  composing: boolean;
  /**
   * True when the path is a Contribute conversation surface — the list (`/dev`),
   * a conversation (`/dev/<id>`), or compose (`/dev/submit`). The desktop split
   * view applies only to these; standalone dev tools under `/dev` return false.
   */
  isConversationRoute: boolean;
}

/**
 * Classify a pathname from expo-router's `usePathname()`. Route groups like
 * `(user)` are stripped from the URL, so paths arrive as `/dev`, `/dev/submit`,
 * `/dev/<id>`, `/dev/feature-flags`, etc.
 */
export function parseDevRoute(pathname: string): DevRoute {
  const none: DevRoute = {
    selectedId: null,
    composing: false,
    isConversationRoute: false,
  };

  // Require `/dev` to be a whole segment (lookahead) so `/devil` never matches.
  const match = pathname.match(/^\/dev(?=$|[/?#])(?:\/([^/?#]+))?/);
  if (!match) return none;

  const sub = match[1];
  // `/dev` — the conversation list / empty right pane.
  if (sub === undefined) return { ...none, isConversationRoute: true };
  // `/dev/submit` — the compose form.
  if (sub === "submit") {
    return { selectedId: null, composing: true, isConversationRoute: true };
  }
  // `/dev/<id>` — an open conversation.
  if (LOOKS_LIKE_CONVEX_ID.test(sub)) {
    return {
      selectedId: sub as Id<"devBugs">,
      composing: false,
      isConversationRoute: true,
    };
  }
  // `/dev/feature-flags`, `/dev/theme-gallery`, … — standalone dev tools.
  return none;
}
