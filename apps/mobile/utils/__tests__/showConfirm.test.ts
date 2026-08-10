/**
 * showConfirm tests
 *
 * A confirmation built directly on `Alert.alert` is a no-op on React Native
 * Web — the user presses the button and nothing happens. These lock in that
 * the helper actually prompts on web, and that every way of dismissing the
 * prompt resolves `false` so a destructive action never runs by default.
 */

import { Alert, Platform } from "react-native";
import { showConfirm } from "../error-handling";

const OPTIONS = {
  title: "Reset to community version?",
  message: "This group's customizations will be replaced.",
  confirmLabel: "Reset",
  cancelLabel: "Keep customizations",
  destructive: true,
};

describe("showConfirm", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, writable: true });
    jest.restoreAllMocks();
  });

  function setPlatform(os: string) {
    Object.defineProperty(Platform, "OS", { value: os, writable: true });
  }

  describe("on web", () => {
    // jest-expo's environment has no `window.confirm` to spy on, so assign
    // the double directly and restore whatever was there afterwards.
    const globalWindow = window as unknown as Record<string, unknown>;
    let originalConfirm: unknown;

    beforeEach(() => {
      setPlatform("web");
      originalConfirm = globalWindow.confirm;
    });

    afterEach(() => {
      globalWindow.confirm = originalConfirm;
    });

    it("prompts via window.confirm and resolves true when accepted", async () => {
      const confirmMock = jest.fn().mockReturnValue(true);
      globalWindow.confirm = confirmMock;

      await expect(showConfirm(OPTIONS)).resolves.toBe(true);
      expect(confirmMock).toHaveBeenCalledWith(
        `${OPTIONS.title}\n\n${OPTIONS.message}`
      );
    });

    it("resolves false when dismissed", async () => {
      globalWindow.confirm = jest.fn().mockReturnValue(false);
      await expect(showConfirm(OPTIONS)).resolves.toBe(false);
    });

    it("does not fall through to the native Alert", async () => {
      globalWindow.confirm = jest.fn().mockReturnValue(true);
      const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

      await showConfirm(OPTIONS);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it("resolves false rather than throwing when no confirm is available", async () => {
      globalWindow.confirm = undefined;
      await expect(showConfirm(OPTIONS)).resolves.toBe(false);
    });
  });

  describe("on native", () => {
    beforeEach(() => setPlatform("ios"));

    it("resolves true when the confirm button is pressed", async () => {
      jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
        buttons?.find((b) => b.text === OPTIONS.confirmLabel)?.onPress?.();
      });

      await expect(showConfirm(OPTIONS)).resolves.toBe(true);
    });

    it("resolves false when the cancel button is pressed", async () => {
      jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
        buttons?.find((b) => b.text === OPTIONS.cancelLabel)?.onPress?.();
      });

      await expect(showConfirm(OPTIONS)).resolves.toBe(false);
    });

    it("resolves false when dismissed with the Android back button", async () => {
      jest.spyOn(Alert, "alert").mockImplementation((_t, _m, _b, opts) => {
        (opts as { onDismiss?: () => void })?.onDismiss?.();
      });

      await expect(showConfirm(OPTIONS)).resolves.toBe(false);
    });

    it("marks the confirm button destructive when asked", async () => {
      const alertSpy = jest
        .spyOn(Alert, "alert")
        .mockImplementation((_t, _m, buttons) => {
          buttons?.find((b) => b.text === OPTIONS.confirmLabel)?.onPress?.();
        });

      await showConfirm(OPTIONS);

      const buttons = alertSpy.mock.calls[0][2];
      expect(
        buttons?.find((b) => b.text === OPTIONS.confirmLabel)?.style
      ).toBe("destructive");
    });
  });
});
