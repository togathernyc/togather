import { getInitialRouteTarget } from "../initialRouteTarget";

describe("getInitialRouteTarget", () => {
  it("routes unauthenticated users to signin", () => {
    const route = getInitialRouteTarget({
      isAuthenticated: false,
      hasCommunity: false,
      hasSlugParam: false,
      hasUserProfile: false,
    });

    expect(route).toBe("/(auth)/signin");
  });

  it("routes authenticated users with community to chat", () => {
    const route = getInitialRouteTarget({
      isAuthenticated: true,
      hasCommunity: true,
      hasSlugParam: false,
      hasUserProfile: true,
    });

    expect(route).toBe("/(tabs)/chat");
  });

  it("routes authenticated users with slug param to chat", () => {
    const route = getInitialRouteTarget({
      isAuthenticated: true,
      hasCommunity: false,
      hasSlugParam: true,
      hasUserProfile: true,
    });

    expect(route).toBe("/(tabs)/chat");
  });

  it("routes token-only authenticated users to profile for offline access", () => {
    const route = getInitialRouteTarget({
      isAuthenticated: true,
      hasCommunity: false,
      hasSlugParam: false,
      hasUserProfile: false,
    });

    expect(route).toBe("/(tabs)/profile");
  });

  it("routes authenticated users without community but with profile to signin", () => {
    const route = getInitialRouteTarget({
      isAuthenticated: true,
      hasCommunity: false,
      hasSlugParam: false,
      hasUserProfile: true,
    });

    expect(route).toBe("/(auth)/signin");
  });
});
