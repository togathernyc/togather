/**
 * Dev-Assistant mount smoke test — catches the package's documented #1
 * operational footgun: `functionsPath` is a bare string, not a typed
 * reference into `_generated/api`, so a wrong path or a renamed/dropped
 * re-export passes `tsc` and `convex deploy` cleanly and then fails
 * SILENTLY at runtime (every internal scheduled call the package makes,
 * e.g. `READY_FOR_IMPL -> dispatchBug`, throws "Could not find function",
 * visible only in the Convex log). Run after any refactor of bugs/actions/
 * contributions/maintainers.ts (see the package README's "Smoke test"
 * section).
 */

import { test, expect } from "vitest";
import { assertMounted, validateMount } from "@supa-media/dev-assistant";
import "../functions/devAssistant/config"; // side-effect: sets config first
import { internal } from "../_generated/api";

test("dev-assistant functionsPath resolves against the generated API", () => {
  expect(() => assertMounted(internal, "functions/devAssistant")).not.toThrow();
});

test("validateMount reports no missing module:function paths", () => {
  const missing = validateMount(internal, "functions/devAssistant");
  expect(missing).toEqual([]);
});
