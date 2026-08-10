/**
 * Cross-platform confirm / notice helpers.
 *
 * React Native's `Alert.alert` is a **no-op on web** in this codebase, so any
 * confirm built on it (Cancel/Delete buttons) silently does nothing on web —
 * the action never runs. These helpers fall back to `window.confirm` /
 * `window.alert` on web and use `Alert.alert` on native, matching the inline
 * pattern already used in `HostsPicker` / `EventPageClient`.
 */
import { Alert, Platform } from "react-native";

/**
 * Body text for a `window.confirm`, with each action's REAL wording spelled
 * out in it.
 *
 * The browser's buttons are always "OK" and "Cancel" — they cannot be
 * relabelled — so a caller's `confirmText: "Move it there"` is otherwise
 * silently dropped and the user is asked to approve an unnamed action. Each
 * `[buttonLabel, meaning]` pair is appended only when the caller actually
 * customised it, so the common OK/Cancel case stays clean.
 */
function webBody(
  title: string,
  message: string,
  actions: Array<[button: string, meaning: string]>,
): string {
  const lines = actions
    .filter(([button, meaning]) => button !== meaning)
    .map(([button, meaning]) => `${button} = ${meaning}`);
  const head = message ? `${title}\n\n${message}` : title;
  return lines.length ? `${head}\n\n${lines.join("\n")}` : head;
}

/**
 * Imperative confirm. Resolves `true` if the user confirms, `false` if they
 * cancel or dismiss. Works on web (window.confirm) and native (Alert.alert).
 */
export function confirmAsync(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** iOS shows the confirm button in red; ignored on web. */
  destructive?: boolean;
}): Promise<boolean> {
  const {
    title,
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    destructive = false,
  } = opts;

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.confirm) {
      return Promise.resolve(false);
    }
    return Promise.resolve(
      window.confirm(
        webBody(title, message, [
          ["OK", confirmText],
          ["Cancel", cancelText],
        ]),
      ),
    );
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message || undefined,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}

/** Which button the user picked in {@link chooseAsync}. */
export type Choice = "primary" | "secondary" | "cancel";

/**
 * Imperative two-action prompt ("open the one you have" / "add another" /
 * cancel). Native gets a single three-button `Alert.alert`.
 *
 * Web has no three-way primitive — `window.confirm` is binary — so it asks the
 * primary action first and, only if declined, offers the secondary. Two small
 * dialogs beats inventing a modal here, and each question stays unambiguous.
 * Order the actions so the one a user most often wants is `primary`.
 *
 * The native button array is platform-branched because the two platforms read
 * it in OPPOSITE directions, and both must put `primary` in the emphasised
 * slot:
 *
 *  - iOS stacks the actions in the order given and forces the `cancel`-styled
 *    one to the bottom, so the first entry after `cancel` is the TOP of the
 *    stack. `isPreferred` additionally bolds it.
 *  - Android maps `[0]→neutral (left), [1]→negative (middle), [2]→positive
 *    (right)` (`Alert.js` pops from the end), and `positive` is the affirmative
 *    slot — so the primary action has to be LAST.
 *
 * With one shared array, whichever platform lost had the accidental action in
 * the emphasised position — which is exactly backwards for a prompt whose
 * whole point is that the accidental second tap is the common case.
 */
export function chooseAsync(opts: {
  title: string;
  message?: string;
  primaryText: string;
  secondaryText: string;
  cancelText?: string;
}): Promise<Choice> {
  const {
    title,
    message = "",
    primaryText,
    secondaryText,
    cancelText = "Cancel",
  } = opts;

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.confirm) {
      return Promise.resolve("cancel");
    }
    if (
      window.confirm(
        webBody(title, message, [
          ["OK", primaryText],
          ["Cancel", "see the other options"],
        ]),
      )
    ) {
      return Promise.resolve("primary");
    }
    // The second dialog REPEATS the title and message. It used to be a bare
    // `confirm("Add another anyway?")` with no context at all — so a user
    // whose first Cancel meant "stop, I didn't want this" was immediately
    // shown an unlabelled prompt, and a reflexive OK created the very
    // duplicate this prompt exists to prevent.
    return Promise.resolve(
      window.confirm(
        webBody(title, message, [
          ["OK", secondaryText],
          ["Cancel", cancelText],
        ]),
      )
        ? "secondary"
        : "cancel",
    );
  }

  return new Promise((resolve) => {
    const cancel = {
      text: cancelText,
      style: "cancel" as const,
      onPress: () => resolve("cancel"),
    };
    const primary = {
      text: primaryText,
      isPreferred: true,
      onPress: () => resolve("primary"),
    };
    const secondary = {
      text: secondaryText,
      onPress: () => resolve("secondary"),
    };
    Alert.alert(
      title,
      message || undefined,
      Platform.OS === "ios"
        ? [cancel, primary, secondary]
        : [cancel, secondary, primary],
      { onDismiss: () => resolve("cancel") },
    );
  });
}

/**
 * One-button informational / error notice. Web uses window.alert (Alert.alert
 * is a no-op there), so a failure message isn't swallowed silently.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.alert) {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
