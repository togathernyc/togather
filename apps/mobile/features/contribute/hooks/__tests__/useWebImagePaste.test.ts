import { renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  handleClipboardPaste,
  attachImagePasteListener,
  useWebImagePaste,
} from "../useWebImagePaste";

/** Build a minimal ClipboardEvent-like object with the given clipboard items. */
function pasteEvent(
  items: Array<{ kind: string; type: string; file?: File }>,
): {
  clipboardData: DataTransfer;
  preventDefault: jest.Mock;
} {
  const dataTransfer = {
    items: items.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file ?? null,
    })),
    files: items.filter((i) => i.file).map((i) => i.file as File),
  } as unknown as DataTransfer;
  return { clipboardData: dataTransfer, preventDefault: jest.fn() };
}

/** A fake DOM node that records paste listeners so tests can dispatch to them. */
function fakeNode() {
  const listeners: Record<string, EventListener[]> = {};
  return {
    addEventListener: jest.fn((type: string, cb: EventListener) => {
      (listeners[type] ??= []).push(cb);
    }),
    removeEventListener: jest.fn((type: string, cb: EventListener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb);
    }),
    dispatch: (type: string, event: unknown) =>
      (listeners[type] ?? []).forEach((cb) => cb(event as Event)),
    listenerCount: (type: string) => (listeners[type] ?? []).length,
  };
}

describe("handleClipboardPaste", () => {
  const originalCreate = global.URL.createObjectURL;

  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  });

  afterEach(() => {
    global.URL.createObjectURL = originalCreate;
  });

  test("attaches a pasted screenshot and prevents the default paste", () => {
    const png = new File(["x"], "screenshot.png", { type: "image/png" });
    const event = pasteEvent([{ kind: "file", type: "image/png", file: png }]);
    const onImageUris = jest.fn();

    handleClipboardPaste(event, onImageUris);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onImageUris).toHaveBeenCalledWith(["blob:mock-url"]);
  });

  test("leaves a plain-text paste untouched", () => {
    const event = pasteEvent([{ kind: "string", type: "text/plain" }]);
    const onImageUris = jest.fn();

    handleClipboardPaste(event, onImageUris);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onImageUris).not.toHaveBeenCalled();
  });

  test("handles multiple pasted images", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    (global.URL.createObjectURL as jest.Mock)
      .mockReturnValueOnce("blob:a")
      .mockReturnValueOnce("blob:b");
    const event = pasteEvent([
      { kind: "file", type: "image/png", file: a },
      { kind: "file", type: "image/jpeg", file: b },
    ]);
    const onImageUris = jest.fn();

    handleClipboardPaste(event, onImageUris);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onImageUris).toHaveBeenCalledWith(["blob:a", "blob:b"]);
  });
});

describe("attachImagePasteListener", () => {
  const originalCreate = global.URL.createObjectURL;

  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  });
  afterEach(() => {
    global.URL.createObjectURL = originalCreate;
  });

  test("adds a paste listener that forwards image URIs, and detaches on cleanup", () => {
    const node = fakeNode();
    const onImageUris = jest.fn();

    const detach = attachImagePasteListener(
      node as unknown as HTMLElement,
      onImageUris,
    );
    expect(node.addEventListener).toHaveBeenCalledWith(
      "paste",
      expect.any(Function),
    );

    const png = new File(["x"], "s.png", { type: "image/png" });
    node.dispatch("paste", pasteEvent([{ kind: "file", type: "image/png", file: png }]));
    expect(onImageUris).toHaveBeenCalledWith(["blob:mock-url"]);

    detach();
    expect(node.removeEventListener).toHaveBeenCalledWith(
      "paste",
      expect.any(Function),
    );
    expect(node.listenerCount("paste")).toBe(0);
  });
});

describe("useWebImagePaste (callback ref)", () => {
  const originalOS = Platform.OS;
  const originalCreate = global.URL.createObjectURL;

  beforeEach(() => {
    (Platform as { OS: string }).OS = "web";
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  });
  afterEach(() => {
    (Platform as { OS: string }).OS = originalOS;
    global.URL.createObjectURL = originalCreate;
  });

  test("re-attaches to a fresh node on remount and detaches the old one", () => {
    const onImageUris = jest.fn();
    const { result } = renderHook(() => useWebImagePaste(onImageUris));
    const ref = result.current;

    // Mount: composer's <textarea> appears.
    const first = fakeNode();
    ref(first);
    expect(first.listenerCount("paste")).toBe(1);

    // Remount (e.g. archive → restore): React calls the ref with null, then the
    // new node. The old listener must be gone and the new node must be wired.
    ref(null);
    expect(first.listenerCount("paste")).toBe(0);

    const second = fakeNode();
    ref(second);
    expect(second.listenerCount("paste")).toBe(1);

    const png = new File(["x"], "s.png", { type: "image/png" });
    second.dispatch(
      "paste",
      pasteEvent([{ kind: "file", type: "image/png", file: png }]),
    );
    expect(onImageUris).toHaveBeenCalledWith(["blob:mock-url"]);
  });

  test("is a no-op on native (Platform.OS !== 'web')", () => {
    (Platform as { OS: string }).OS = "ios";
    const { result } = renderHook(() => useWebImagePaste(jest.fn()));
    const node = fakeNode();
    result.current(node);
    expect(node.addEventListener).not.toHaveBeenCalled();
  });
});
