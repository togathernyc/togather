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
});
