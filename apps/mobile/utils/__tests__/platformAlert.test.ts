/**
 * Cross-platform confirm helpers.
 *
 * Both branches have failed silently before: `Alert.alert` is a no-op on web
 * (so a confirm built on it never runs its action), and `window.confirm`'s
 * buttons are hardcoded "OK"/"Cancel" (so a caller's wording vanishes unless it
 * is put in the body). These tests pin the wording AND the native button order,
 * which is the part no test can otherwise see.
 */
import { Alert, Platform } from "react-native";

import { chooseAsync, confirmAsync } from "../platformAlert";

type Button = { text?: string; style?: string; isPreferred?: boolean };

function lastAlertButtons(): Button[] {
  const spy = Alert.alert as unknown as jest.Mock;
  return spy.mock.calls[spy.mock.calls.length - 1][2] as Button[];
}

describe("confirmAsync", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // Test-only platform override.
    Platform.OS = "ios";
  });

  it("spells the confirm action out on web, where the button is always 'OK'", async () => {
    // Test-only platform override.
    Platform.OS = "web";
    const confirm = jest.fn().mockReturnValue(true);
    // @ts-expect-error — jsdom window stub.
    global.window = { confirm };

    await expect(
      confirmAsync({
        title: "Already a plan on Sun, Aug 2",
        message: '"Sunday Service" is already on that date.',
        confirmText: "Move it there",
      }),
    ).resolves.toBe(true);

    const body = confirm.mock.calls[0][0] as string;
    expect(body).toContain("Already a plan on Sun, Aug 2");
    expect(body).toContain('"Sunday Service" is already on that date.');
    // Without this the user approves an unnamed action.
    expect(body).toContain("OK = Move it there");
  });

  it("leaves a plain OK/Cancel confirm unadorned", async () => {
    // Test-only platform override.
    Platform.OS = "web";
    const confirm = jest.fn().mockReturnValue(false);
    // @ts-expect-error — jsdom window stub.
    global.window = { confirm };

    await confirmAsync({ title: "Delete event plan?", message: "Are you sure?" });
    expect(confirm.mock.calls[0][0]).toBe(
      "Delete event plan?\n\nAre you sure?",
    );
  });
});

describe("chooseAsync", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // Test-only platform override.
    Platform.OS = "ios";
  });

  const opts = {
    title: "Already a plan on Sun, Aug 2",
    message: '"Sunday Service" is already on that date.',
    primaryText: "Open the existing plan",
    secondaryText: "Add another anyway",
  };

  it("keeps the title and message on the web fallback's SECOND dialog", async () => {
    // Test-only platform override.
    Platform.OS = "web";
    // Decline the first (primary) question, accept the second.
    const confirm = jest
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    // @ts-expect-error — jsdom window stub.
    global.window = { confirm };

    await expect(chooseAsync(opts)).resolves.toBe("secondary");

    const second = confirm.mock.calls[1][0] as string;
    // It used to be a bare "Add another anyway?" — a user whose first Cancel
    // meant "stop entirely" got an unlabelled prompt, and a reflexive OK made
    // the duplicate this whole flow exists to prevent.
    expect(second).toContain("Already a plan on Sun, Aug 2");
    expect(second).toContain('"Sunday Service" is already on that date.');
    expect(second).toContain("OK = Add another anyway");
    // The default "Cancel" needs no gloss — the browser's own button says it.
    expect(second).not.toContain("Cancel = Cancel");
  });

  it("glosses a custom cancel label on the second web dialog", async () => {
    // Test-only platform override.
    Platform.OS = "web";
    const confirm = jest.fn().mockReturnValue(false);
    // @ts-expect-error — jsdom window stub.
    global.window = { confirm };

    await expect(
      chooseAsync({ ...opts, cancelText: "Leave it alone" }),
    ).resolves.toBe("cancel");
    expect(confirm.mock.calls[1][0]).toContain("Cancel = Leave it alone");
  });

  it("names both web actions on the first dialog too", async () => {
    // Test-only platform override.
    Platform.OS = "web";
    const confirm = jest.fn().mockReturnValue(true);
    // @ts-expect-error — jsdom window stub.
    global.window = { confirm };

    await expect(chooseAsync(opts)).resolves.toBe("primary");
    const first = confirm.mock.calls[0][0] as string;
    expect(first).toContain("OK = Open the existing plan");
    expect(first).toContain("Cancel = see the other options");
  });

  it("puts the primary action at the TOP of the iOS stack", async () => {
    // Test-only platform override.
    Platform.OS = "ios";
    jest.spyOn(Alert, "alert").mockImplementation(() => {});

    void chooseAsync(opts);
    const buttons = lastAlertButtons();
    // iOS renders in the order given but forces `cancel` to the bottom, so the
    // first non-cancel entry is what the leader reads first. With the primary
    // last, "Add another anyway" sat on top — the accidental action.
    expect(buttons.map((b) => b.text)).toEqual([
      "Cancel",
      "Open the existing plan",
      "Add another anyway",
    ]);
    expect(buttons[0].style).toBe("cancel");
    expect(buttons[1].isPreferred).toBe(true);
  });

  it("puts the primary action in Android's positive (rightmost) slot", async () => {
    // Test-only platform override.
    Platform.OS = "android";
    jest.spyOn(Alert, "alert").mockImplementation(() => {});

    void chooseAsync(opts);
    // RN's Alert.js pops from the end: [0]→neutral, [1]→negative,
    // [2]→positive. The affirmative slot is last, the opposite of iOS.
    expect(lastAlertButtons().map((b) => b.text)).toEqual([
      "Cancel",
      "Add another anyway",
      "Open the existing plan",
    ]);
  });

  it("resolves with the button the user actually pressed", async () => {
    // Test-only platform override.
    Platform.OS = "ios";
    jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const pending = chooseAsync(opts);
    const buttons = lastAlertButtons() as Array<{ onPress: () => void }>;
    buttons[2].onPress(); // "Add another anyway" on iOS
    await expect(pending).resolves.toBe("secondary");
  });
});
