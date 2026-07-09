import { Linking } from "react-native";
import { redirectSystemPath } from "../+native-intent";

// The +native-intent hook decides whether an incoming universal link is handled
// by the app or bounced back to the browser. Web-only routes (served by the Vite
// site, not the Expo app) must be bounced so the user never lands on the app's
// "Page Not Found" screen — see WEB_ONLY_ROOTS in +native-intent.ts.

describe("redirectSystemPath — web-only bounce", () => {
  beforeEach(() => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    (Linking.openURL as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const webOnly = [
    "https://togather.nyc/contribute",
    "https://togather.nyc/contribute/ai",
    "https://togather.nyc/guides",
    "https://togather.nyc/guides/branding",
    "https://togather.nyc/developers",
    "https://togather.nyc/issue",
    "https://togather.nyc/legal/privacy",
    "https://togather.nyc/onboarding/go-live",
  ];

  it.each(webOnly)("bounces %s to the browser and returns root", (url) => {
    expect(redirectSystemPath({ path: url, initial: true })).toBe("/");
    expect(Linking.openURL).toHaveBeenCalledWith(url);
  });

  const appRoutes = [
    "https://togather.nyc/nearme",
    "https://togather.nyc/e/abc123",
    "https://togather.nyc/g/xyz789",
  ];

  it.each(appRoutes)("does not bounce app route %s", (url) => {
    const result = redirectSystemPath({ path: url, initial: true });
    expect(result).not.toBe("/");
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("does not treat a slug that merely starts with a web-only word as web-only", () => {
    // "/guidesxyz" is a community slug, not the "/guides" hub.
    const url = "https://togather.nyc/guidesxyz";
    const result = redirectSystemPath({ path: url, initial: true });
    expect(result).not.toBe("/");
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
