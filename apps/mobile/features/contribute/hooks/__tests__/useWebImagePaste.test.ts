import { handleClipboardPaste } from "../useWebImagePaste";

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
