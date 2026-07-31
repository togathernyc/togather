/**
 * Tests for the inboxGroupCollapse Zustand store.
 *
 * The persistence-round-trip test simulates an app relaunch the way it
 * really happens: a fresh module instance is created (via
 * `jest.resetModules`), which re-triggers zustand `persist`'s automatic
 * hydration from (mocked) AsyncStorage — rather than mutating the live
 * store's state directly, which would just re-persist over our fixture.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useInboxGroupCollapse } from "../inboxGroupCollapse";

describe("inboxGroupCollapse", () => {
  beforeEach(() => {
    useInboxGroupCollapse.getState().clearAll();
  });

  it("defaults a group to expanded (not collapsed)", () => {
    expect(useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(false);
  });

  it("toggling collapses a group", () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    expect(useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(true);
  });

  it("toggling twice returns to expanded", () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    expect(useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(false);
  });

  it("keeps groups' collapsed state independent", () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    expect(useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(true);
    expect(useInboxGroupCollapse.getState().isCollapsed("group-2")).toBe(false);
  });

  it("clears everything", () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    useInboxGroupCollapse.getState().toggleCollapsed("group-2");
    useInboxGroupCollapse.getState().clearAll();
    expect(useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(false);
    expect(useInboxGroupCollapse.getState().isCollapsed("group-2")).toBe(false);
    expect(useInboxGroupCollapse.getState().collapsedGroupIds).toEqual({});
  });

  it("writes collapsed state to AsyncStorage under the store's key", async () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    // The persist middleware's AsyncStorage write is async; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await AsyncStorage.getItem("inbox-group-collapse");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.collapsedGroupIds).toEqual({
      "group-1": true,
    });
  });

  it("persists collapsed state across a simulated app relaunch", async () => {
    useInboxGroupCollapse.getState().toggleCollapsed("group-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Simulate an app relaunch: a brand new module instance, which re-runs
    // zustand persist's automatic storage-hydration on creation.
    let freshModule: typeof import("../inboxGroupCollapse");
    await jest.isolateModulesAsync(async () => {
      freshModule = require("../inboxGroupCollapse");
      // Hydration reads AsyncStorage asynchronously; wait for it to finish.
      await freshModule.useInboxGroupCollapse.persist.rehydrate();
    });

    expect(freshModule!.useInboxGroupCollapse.getState().isCollapsed("group-1")).toBe(
      true,
    );
  });

  describe("hasHydrated", () => {
    // A "starts false before rehydration resolves" test isn't reliably
    // expressible here: the official AsyncStorage jest mock resolves on a
    // microtask, same as `jest.isolateModulesAsync`'s own await, so by the
    // time control returns to the test hydration has already settled either
    // way. On a real device the AsyncStorage read crosses the native bridge
    // and is genuinely slower than first render — that's the flash this flag
    // exists to prevent (see `eventModeStore.ts`, which has the same gap in
    // its own test suite for the same reason).

    it("flips true once rehydration resolves, even with no saved state", async () => {
      let freshModule: typeof import("../inboxGroupCollapse");
      await jest.isolateModulesAsync(async () => {
        freshModule = require("../inboxGroupCollapse");
        await freshModule.useInboxGroupCollapse.persist.rehydrate();
      });

      expect(freshModule!.useInboxGroupCollapse.getState().hasHydrated).toBe(true);
    });

    it("setHasHydrated sets the flag directly", () => {
      useInboxGroupCollapse.getState().setHasHydrated(false);
      expect(useInboxGroupCollapse.getState().hasHydrated).toBe(false);
      useInboxGroupCollapse.getState().setHasHydrated(true);
      expect(useInboxGroupCollapse.getState().hasHydrated).toBe(true);
    });
  });
});
