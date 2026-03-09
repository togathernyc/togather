/**
 * Tests for the landing page form field reorder logic.
 *
 * The core operations: moveField, addField, deleteField.
 * These must maintain unique, sequential order values to avoid
 * no-op swaps when two fields share the same order.
 */

type FormField = {
  slot?: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
};

// ---- Pure functions extracted from LandingPageContent ----

/**
 * Current (buggy) implementation: swaps order values.
 * Fails when two fields have the same order.
 */
function moveFieldBuggy(
  fields: FormField[],
  index: number,
  direction: -1 | 1
): FormField[] {
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  const targetIdx = index + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return fields;
  const tempOrder = sorted[index].order;
  sorted[index] = { ...sorted[index], order: sorted[targetIdx].order };
  sorted[targetIdx] = { ...sorted[targetIdx], order: tempOrder };
  return sorted;
}

/**
 * Fixed implementation: swaps array positions then reassigns sequential orders.
 */
function moveFieldFixed(
  fields: FormField[],
  index: number,
  direction: -1 | 1
): FormField[] {
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  const targetIdx = index + direction;
  if (targetIdx < 0 || targetIdx >= sorted.length) return fields;
  // Swap positions in array
  const temp = sorted[index];
  sorted[index] = sorted[targetIdx];
  sorted[targetIdx] = temp;
  // Reassign sequential orders
  return sorted.map((field, i) => ({ ...field, order: i }));
}

// Helper: get labels in display order
function displayOrder(fields: FormField[]): string[] {
  return [...fields].sort((a, b) => a.order - b.order).map((f) => f.label);
}

// Helper: check all orders are unique
function hasUniqueOrders(fields: FormField[]): boolean {
  const orders = fields.map((f) => f.order);
  return new Set(orders).size === orders.length;
}

// ---- Test data ----

function makeFields(...labels: string[]): FormField[] {
  return labels.map((label, i) => ({
    label,
    type: "text",
    required: false,
    order: i,
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe("moveField", () => {
  describe("basic reordering with unique orders", () => {
    const fields = makeFields("A", "B", "C", "D", "E");

    it("moves an item up", () => {
      const result = moveFieldFixed(fields, 2, -1); // Move C up
      expect(displayOrder(result)).toEqual(["A", "C", "B", "D", "E"]);
    });

    it("moves an item down", () => {
      const result = moveFieldFixed(fields, 1, 1); // Move B down
      expect(displayOrder(result)).toEqual(["A", "C", "B", "D", "E"]);
    });

    it("does nothing when moving first item up", () => {
      const result = moveFieldFixed(fields, 0, -1);
      expect(displayOrder(result)).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("does nothing when moving last item down", () => {
      const result = moveFieldFixed(fields, 4, 1);
      expect(displayOrder(result)).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("moves second-to-last item up", () => {
      const result = moveFieldFixed(fields, 3, -1); // Move D up
      expect(displayOrder(result)).toEqual(["A", "B", "D", "C", "E"]);
    });
  });

  describe("BUG: duplicate order values cause no-op swap", () => {
    // Simulate: delete middle field, then add new field with order=prev.length
    // Fields [0,1,2,3,4] → delete order 2 → [0,1,3,4] → add with order=4 → [0,1,3,4,4]
    const fieldsWithDuplicateOrders: FormField[] = [
      { label: "A", type: "text", required: false, order: 0 },
      { label: "B", type: "text", required: false, order: 1 },
      { label: "C", type: "text", required: false, order: 3 },
      { label: "D", type: "text", required: false, order: 4 },
      { label: "New", type: "text", required: false, order: 4 }, // duplicate!
    ];

    it("buggy version: second-to-last move up is a NO-OP with duplicate orders", () => {
      // This demonstrates the bug: D and New both have order 4
      // Moving D (sortedIndex 3) up should swap with C (sortedIndex 2, order 3)
      // But the sorted position of D vs New is unstable with equal orders
      const result = moveFieldBuggy(fieldsWithDuplicateOrders, 3, -1);
      const order = displayOrder(result);
      // With stable sort, D is at index 3 and New at index 4 (both order 4)
      // Swapping D (order 4) with C (order 3) → D gets 3, C gets 4
      // This specific case might work, but last item up will fail:
      const result2 = moveFieldBuggy(fieldsWithDuplicateOrders, 4, -1);
      // Moving New (index 4, order 4) up to swap with D (index 3, order 4)
      // Both have order 4 → swap is a no-op!
      const order2 = displayOrder(result2);
      // Bug: the order doesn't change
      expect(order2).toEqual(displayOrder(fieldsWithDuplicateOrders));
    });

    it("fixed version: handles duplicate orders correctly", () => {
      // Moving last item (sortedIndex 4) up should swap it with sortedIndex 3
      const result = moveFieldFixed(fieldsWithDuplicateOrders, 4, -1);
      const order = displayOrder(result);
      // "New" should now be before "D"
      expect(order[3]).toBe("New");
      expect(order[4]).toBe("D");
      expect(hasUniqueOrders(result)).toBe(true);
    });

    it("fixed version: second-to-last up works with duplicate orders", () => {
      const result = moveFieldFixed(fieldsWithDuplicateOrders, 3, -1);
      const order = displayOrder(result);
      // "D" should now be before "C"
      expect(order[2]).toBe("D");
      expect(order[3]).toBe("C");
      expect(hasUniqueOrders(result)).toBe(true);
    });
  });

  describe("non-sequential orders (gaps from deletion)", () => {
    // After deleting a middle field, orders have gaps: [0, 1, 5, 8]
    const gappyFields: FormField[] = [
      { label: "A", type: "text", required: false, order: 0 },
      { label: "B", type: "text", required: false, order: 1 },
      { label: "C", type: "text", required: false, order: 5 },
      { label: "D", type: "text", required: false, order: 8 },
    ];

    it("fixed version normalizes orders after move", () => {
      const result = moveFieldFixed(gappyFields, 2, -1); // Move C up
      expect(displayOrder(result)).toEqual(["A", "C", "B", "D"]);
      expect(hasUniqueOrders(result)).toBe(true);
      // Orders should be sequential
      const orders = [...result].sort((a, b) => a.order - b.order).map((f) => f.order);
      expect(orders).toEqual([0, 1, 2, 3]);
    });
  });

  describe("normalizeFieldOrders (on load from existing config)", () => {
    function normalizeFieldOrders(fields: FormField[]): FormField[] {
      return [...fields]
        .sort((a, b) => a.order - b.order)
        .map((f, i) => ({ ...f, order: i }));
    }

    it("fixes duplicate orders from existing saved config", () => {
      const staleConfig: FormField[] = [
        { label: "A", type: "text", required: false, order: 0 },
        { label: "B", type: "text", required: false, order: 1 },
        { label: "C", type: "text", required: false, order: 4 },
        { label: "D", type: "text", required: false, order: 4 },
      ];
      const normalized = normalizeFieldOrders(staleConfig);
      expect(hasUniqueOrders(normalized)).toBe(true);
      expect(normalized.map((f) => f.order)).toEqual([0, 1, 2, 3]);
      // Preserves relative order
      expect(displayOrder(normalized)).toEqual(["A", "B", "C", "D"]);
    });

    it("fixes gaps from deleted fields in existing config", () => {
      const staleConfig: FormField[] = [
        { label: "A", type: "text", required: false, order: 0 },
        { label: "B", type: "text", required: false, order: 3 },
        { label: "C", type: "text", required: false, order: 7 },
      ];
      const normalized = normalizeFieldOrders(staleConfig);
      expect(normalized.map((f) => f.order)).toEqual([0, 1, 2]);
      expect(displayOrder(normalized)).toEqual(["A", "B", "C"]);
    });

    it("reorder works correctly on normalized stale config", () => {
      const staleConfig: FormField[] = [
        { label: "A", type: "text", required: false, order: 0 },
        { label: "B", type: "text", required: false, order: 1 },
        { label: "C", type: "text", required: false, order: 5 },
        { label: "D", type: "text", required: false, order: 5 },
      ];
      // Normalize on load (as useEffect now does)
      const normalized = normalizeFieldOrders(staleConfig);
      // Now move second-to-last up — previously a no-op with duplicate orders
      const result = moveFieldFixed(normalized, 2, -1);
      expect(displayOrder(result)).toEqual(["A", "C", "B", "D"]);
      expect(hasUniqueOrders(result)).toBe(true);
    });
  });

  describe("sequential moves (multiple reorders)", () => {
    it("can move an item from last to first via repeated up moves", () => {
      let fields = makeFields("A", "B", "C", "D");
      // Move D from index 3 to top
      fields = moveFieldFixed(fields, 3, -1); // ["A", "B", "D", "C"]
      fields = moveFieldFixed(fields, 2, -1); // ["A", "D", "B", "C"]
      fields = moveFieldFixed(fields, 1, -1); // ["D", "A", "B", "C"]
      expect(displayOrder(fields)).toEqual(["D", "A", "B", "C"]);
      expect(hasUniqueOrders(fields)).toBe(true);
    });

    it("move up then move down returns to original order", () => {
      const fields = makeFields("A", "B", "C");
      const moved = moveFieldFixed(fields, 1, -1); // ["B", "A", "C"]
      const restored = moveFieldFixed(moved, 0, 1); // ["A", "B", "C"]
      expect(displayOrder(restored)).toEqual(["A", "B", "C"]);
    });
  });
});
