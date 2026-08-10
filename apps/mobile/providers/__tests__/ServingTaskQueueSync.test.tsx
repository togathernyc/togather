/**
 * Tests for ServingTaskQueueSync — the app-wide flusher for the persisted
 * serving-task completion queue.
 *
 * The point of this component (issue #557) is that the flush is NOT tied to the
 * Tasks screen: every test here renders the flusher on its own, with no serving
 * screen mounted at all.
 */
import React from "react";
import { render, waitFor, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { AppStateStatus, NativeEventSubscription } from "react-native";
import { ServingTaskQueueSync } from "../ServingTaskQueueSync";

// --- Connectivity ------------------------------------------------------------
let mockIsEffectivelyOffline = false;
jest.mock("@providers/ConnectionProvider", () => ({
  useConnectionStatus: () => ({
    isEffectivelyOffline: mockIsEffectivelyOffline,
  }),
}));

// --- The persisted queue -----------------------------------------------------
interface Entry {
  id: string;
  planId: string;
  kind: "template" | "personal" | "shared";
  taskId: string;
  timeLabel?: string;
  completed: boolean;
  queuedAt: number;
}
let mockPending: Record<string, Entry> = {};
const mockDequeue = jest.fn((id: string) => {
  const next = { ...mockPending };
  delete next[id];
  mockPending = next;
});
const mockQueueState = {
  get pending() {
    return mockPending;
  },
  dequeue: mockDequeue,
  all: () => Object.values(mockPending),
};
jest.mock("@/stores/servingTaskQueue", () => {
  const hook = (sel: (s: typeof mockQueueState) => unknown) => sel(mockQueueState);
  (hook as unknown as { getState: () => typeof mockQueueState }).getState = () =>
    mockQueueState;
  return { useServingTaskQueue: hook };
});

// --- Convex mutations --------------------------------------------------------
const mockToggleTaskCompletion = jest.fn();
const mockTogglePersonalTask = jest.fn();
const mockToggleSharedTeamTask = jest.fn();
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        eventTasks: {
          toggleTaskCompletion: "toggleTaskCompletion",
          togglePersonalTask: "togglePersonalTask",
          toggleSharedTeamTask: "toggleSharedTeamTask",
        },
      },
    },
  },
  useAuthenticatedMutation: (ref: string) => {
    if (ref === "toggleTaskCompletion") return mockToggleTaskCompletion;
    if (ref === "togglePersonalTask") return mockTogglePersonalTask;
    return mockToggleSharedTeamTask;
  },
}));

function entry(overrides: Partial<Entry> & Pick<Entry, "id">): Entry {
  return {
    planId: "plan-1",
    kind: "personal",
    taskId: "task-1",
    completed: true,
    queuedAt: 1,
    ...overrides,
  };
}

/** Seeds the queue with the given entries, keyed by id. */
function seedQueue(...entries: Entry[]) {
  mockPending = Object.fromEntries(entries.map((e) => [e.id, e]));
}

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsEffectivelyOffline = false;
  mockPending = {};
  appStateHandler = null;
  mockToggleTaskCompletion.mockResolvedValue(undefined);
  mockTogglePersonalTask.mockResolvedValue(undefined);
  mockToggleSharedTeamTask.mockResolvedValue(undefined);
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event, handler) => {
      if (event === "change") appStateHandler = handler;
      return { remove: jest.fn() } as unknown as NativeEventSubscription;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ServingTaskQueueSync", () => {
  it("flushes queued completions with no serving screen mounted", async () => {
    seedQueue(
      entry({ id: "personal:p1", kind: "personal", taskId: "p1", completed: true }),
      entry({
        id: "template:t1:9AM",
        kind: "template",
        taskId: "t1",
        timeLabel: "9AM",
        completed: false,
      }),
      entry({ id: "shared:s1", kind: "shared", taskId: "s1", completed: true }),
    );

    render(<ServingTaskQueueSync />);

    await waitFor(() => expect(mockDequeue).toHaveBeenCalledTimes(3));
    expect(mockTogglePersonalTask).toHaveBeenCalledWith({
      taskId: "p1",
      completed: true,
    });
    expect(mockToggleTaskCompletion).toHaveBeenCalledWith({
      taskId: "t1",
      timeLabel: "9AM",
      completed: false,
    });
    expect(mockToggleSharedTeamTask).toHaveBeenCalledWith({
      planId: "plan-1",
      taskId: "s1",
      completed: true,
    });
  });

  it("does not send anything while offline", async () => {
    mockIsEffectivelyOffline = true;
    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));

    render(<ServingTaskQueueSync />);

    await act(async () => {});
    expect(mockTogglePersonalTask).not.toHaveBeenCalled();
    expect(mockDequeue).not.toHaveBeenCalled();
  });

  it("flushes when connectivity returns", async () => {
    mockIsEffectivelyOffline = true;
    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));

    const { rerender } = render(<ServingTaskQueueSync />);
    await act(async () => {});
    expect(mockTogglePersonalTask).not.toHaveBeenCalled();

    mockIsEffectivelyOffline = false;
    rerender(<ServingTaskQueueSync />);

    await waitFor(() => expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1));
  });

  it("flushes when the app returns to the foreground", async () => {
    // Signal came back while the app was backgrounded, so no connectivity
    // transition happens while we're rendered — foregrounding is the trigger.
    render(<ServingTaskQueueSync />);
    await act(async () => {});
    expect(mockTogglePersonalTask).not.toHaveBeenCalled();

    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));
    await act(async () => {
      appStateHandler?.("active");
    });

    await waitFor(() => expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1));
  });

  it("does not flush on foreground while offline", async () => {
    mockIsEffectivelyOffline = true;
    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));

    render(<ServingTaskQueueSync />);
    await act(async () => {
      appStateHandler?.("active");
    });

    expect(mockTogglePersonalTask).not.toHaveBeenCalled();
  });

  it("never sends the same entry twice when two triggers overlap", async () => {
    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));
    let resolveSend: (() => void) | undefined;
    mockTogglePersonalTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );

    const { rerender } = render(<ServingTaskQueueSync />);
    await waitFor(() => expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1));

    // A second trigger (foreground + a re-render) lands mid-flight.
    await act(async () => {
      appStateHandler?.("active");
      rerender(<ServingTaskQueueSync />);
    });
    expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend?.();
    });
    await waitFor(() => expect(mockDequeue).toHaveBeenCalledTimes(1));
  });

  it("leaves an entry queued when its mutation fails, and retries later", async () => {
    seedQueue(entry({ id: "personal:p1", taskId: "p1" }));
    mockTogglePersonalTask.mockRejectedValueOnce(new Error("server exploded"));

    const { rerender } = render(<ServingTaskQueueSync />);
    await waitFor(() => expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1));
    expect(mockDequeue).not.toHaveBeenCalled();
    expect(mockPending["personal:p1"]).toBeDefined();

    // A later trigger retries it — a failed send must not strand the entry.
    await act(async () => {
      appStateHandler?.("active");
      rerender(<ServingTaskQueueSync />);
    });
    await waitFor(() => expect(mockDequeue).toHaveBeenCalledWith("personal:p1"));
  });

  it("keeps a newer intent queued when the task is re-toggled mid-flush", async () => {
    seedQueue(entry({ id: "personal:p1", taskId: "p1", completed: true }));
    let resolveSend: (() => void) | undefined;
    mockTogglePersonalTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );

    render(<ServingTaskQueueSync />);
    await waitFor(() => expect(mockTogglePersonalTask).toHaveBeenCalledTimes(1));

    // User goes offline again mid-flush and unchecks the task.
    mockPending = {
      "personal:p1": entry({ id: "personal:p1", taskId: "p1", completed: false }),
    };
    await act(async () => {
      resolveSend?.();
    });

    await act(async () => {});
    expect(mockDequeue).not.toHaveBeenCalled();
    expect(mockPending["personal:p1"].completed).toBe(false);
  });
});
