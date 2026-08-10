/**
 * Tests for servingTaskQueue Zustand store
 */
import {
  useServingTaskQueue,
  completionId,
} from "../servingTaskQueue";

describe("servingTaskQueue", () => {
  beforeEach(() => {
    useServingTaskQueue.getState().clear();
  });

  describe("completionId", () => {
    it("includes timeLabel for template tasks (per-service-time identity)", () => {
      expect(completionId("template", "t1", "9AM")).toBe("template:t1:9AM");
      expect(completionId("template", "t1", "11AM")).toBe("template:t1:11AM");
      expect(completionId("template", "t1")).toBe("template:t1:");
    });

    it("keys personal and shared tasks by taskId alone", () => {
      expect(completionId("personal", "p1")).toBe("personal:p1");
      expect(completionId("shared", "s1", "ignored")).toBe("shared:s1");
    });
  });

  it("enqueues a desired completion state", () => {
    useServingTaskQueue
      .getState()
      .enqueue({ planId: "plan1", kind: "personal", taskId: "p1", completed: true });

    expect(
      useServingTaskQueue.getState().desiredState("personal", "p1"),
    ).toBe(true);
    expect(useServingTaskQueue.getState().all()).toHaveLength(1);
  });

  it("returns undefined desiredState when nothing is queued", () => {
    expect(
      useServingTaskQueue.getState().desiredState("personal", "nope"),
    ).toBeUndefined();
  });

  it("collapses repeated toggles of the same task (last-write-wins)", () => {
    const q = useServingTaskQueue.getState();
    q.enqueue({ planId: "plan1", kind: "personal", taskId: "p1", completed: true });
    q.enqueue({ planId: "plan1", kind: "personal", taskId: "p1", completed: false });

    expect(useServingTaskQueue.getState().all()).toHaveLength(1);
    expect(
      useServingTaskQueue.getState().desiredState("personal", "p1"),
    ).toBe(false);
  });

  it("distinguishes the same template task across service times", () => {
    const q = useServingTaskQueue.getState();
    q.enqueue({ planId: "plan1", kind: "template", taskId: "t1", timeLabel: "9AM", completed: true });
    q.enqueue({ planId: "plan1", kind: "template", taskId: "t1", timeLabel: "11AM", completed: false });

    expect(useServingTaskQueue.getState().all()).toHaveLength(2);
    expect(
      useServingTaskQueue.getState().desiredState("template", "t1", "9AM"),
    ).toBe(true);
    expect(
      useServingTaskQueue.getState().desiredState("template", "t1", "11AM"),
    ).toBe(false);
  });

  it("dequeues a synced entry", () => {
    const q = useServingTaskQueue.getState();
    q.enqueue({ planId: "plan1", kind: "shared", taskId: "s1", completed: true });
    q.dequeue(completionId("shared", "s1"));

    expect(useServingTaskQueue.getState().all()).toHaveLength(0);
    expect(
      useServingTaskQueue.getState().desiredState("shared", "s1"),
    ).toBeUndefined();
  });

  it("carries the fields needed to replay each kind", () => {
    const q = useServingTaskQueue.getState();
    q.enqueue({ planId: "plan1", kind: "shared", taskId: "s1", completed: true });
    const entry = useServingTaskQueue.getState().all()[0];
    expect(entry).toMatchObject({
      planId: "plan1",
      kind: "shared",
      taskId: "s1",
      completed: true,
    });
    expect(typeof entry.queuedAt).toBe("number");
  });
});
