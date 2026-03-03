/**
 * Tests for runSheetCache Zustand store
 */
import { useRunSheetCache } from "../runSheetCache";

describe("runSheetCache", () => {
  beforeEach(() => {
    useRunSheetCache.getState().clearAll();
  });

  // Run sheet tests
  describe("run sheets", () => {
    it("stores and retrieves a run sheet", () => {
      const mockSheet = { planId: "p1", title: "Sunday Service", items: [] };

      useRunSheetCache.getState().setRunSheet("g1", "st1", mockSheet);

      const result = useRunSheetCache.getState().getRunSheet("g1", "st1");
      expect(result).toEqual(mockSheet);
    });

    it("returns null for non-existent run sheet", () => {
      const result = useRunSheetCache.getState().getRunSheet("g1", "st1");
      expect(result).toBeNull();
    });

    it("returns null for expired cache (>4h)", () => {
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st1", { title: "Test" });

      const sheets = { ...useRunSheetCache.getState().sheets };
      sheets["g1:st1"] = {
        ...sheets["g1:st1"],
        timestamp: Date.now() - 5 * 60 * 60 * 1000, // 5 hours ago
      };
      useRunSheetCache.setState({ sheets });

      expect(useRunSheetCache.getState().getRunSheet("g1", "st1")).toBeNull();
    });

    it("supports different service types for same group", () => {
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st1", { title: "Morning" });
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st2", { title: "Evening" });

      expect(useRunSheetCache.getState().getRunSheet("g1", "st1")?.title).toBe(
        "Morning"
      );
      expect(useRunSheetCache.getState().getRunSheet("g1", "st2")?.title).toBe(
        "Evening"
      );
    });

    it("evicts oldest entries when exceeding 20 sheets", () => {
      for (let i = 0; i < 20; i++) {
        useRunSheetCache
          .getState()
          .setRunSheet("g1", `st${i}`, { title: `Sheet ${i}` });
      }

      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st20", { title: "Sheet 20" });

      expect(
        useRunSheetCache.getState().getRunSheet("g1", "st20")
      ).not.toBeNull();
      expect(Object.keys(useRunSheetCache.getState().sheets).length).toBe(20);
    });

    it("overwrites existing cache for same key", () => {
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st1", { title: "Old" });
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st1", { title: "New" });

      expect(useRunSheetCache.getState().getRunSheet("g1", "st1")?.title).toBe(
        "New"
      );
    });
  });

  // Service types tests
  describe("service types", () => {
    it("stores and retrieves service types", () => {
      const mockTypes = [
        { id: "st1", name: "Sunday AM" },
        { id: "st2", name: "Sunday PM" },
      ];

      useRunSheetCache.getState().setServiceTypes("g1", mockTypes);

      const result = useRunSheetCache.getState().getServiceTypes("g1");
      expect(result).toEqual(mockTypes);
    });

    it("returns null for non-existent service types", () => {
      expect(
        useRunSheetCache.getState().getServiceTypes("nonexistent")
      ).toBeNull();
    });

    it("returns null for expired service types (>4h)", () => {
      useRunSheetCache
        .getState()
        .setServiceTypes("g1", [{ id: "st1", name: "Test" }]);

      const serviceTypes = { ...useRunSheetCache.getState().serviceTypes };
      serviceTypes["g1"] = {
        ...serviceTypes["g1"],
        timestamp: Date.now() - 5 * 60 * 60 * 1000,
      };
      useRunSheetCache.setState({ serviceTypes });

      expect(useRunSheetCache.getState().getServiceTypes("g1")).toBeNull();
    });

    it("supports multiple groups", () => {
      useRunSheetCache
        .getState()
        .setServiceTypes("g1", [{ id: "st1", name: "AM" }]);
      useRunSheetCache
        .getState()
        .setServiceTypes("g2", [{ id: "st2", name: "PM" }]);

      expect(
        useRunSheetCache.getState().getServiceTypes("g1")![0].name
      ).toBe("AM");
      expect(
        useRunSheetCache.getState().getServiceTypes("g2")![0].name
      ).toBe("PM");
    });
  });

  // Clear all tests
  describe("clearAll", () => {
    it("clears both sheets and service types", () => {
      useRunSheetCache
        .getState()
        .setRunSheet("g1", "st1", { title: "Test" });
      useRunSheetCache
        .getState()
        .setServiceTypes("g1", [{ id: "st1" }]);

      useRunSheetCache.getState().clearAll();

      expect(useRunSheetCache.getState().getRunSheet("g1", "st1")).toBeNull();
      expect(useRunSheetCache.getState().getServiceTypes("g1")).toBeNull();
    });
  });
});
