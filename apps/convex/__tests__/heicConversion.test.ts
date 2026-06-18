import { describe, test, expect } from "vitest";
import {
  isConvertibleHeicAttachment,
  jpegFileName,
} from "../lib/heicConversion";

describe("isConvertibleHeicAttachment", () => {
  test("matches image attachment by HEIC mime type", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "image",
        url: "r2:chat/abc-photo",
        mimeType: "image/heic",
      })
    ).toBe(true);
  });

  test("matches HEIF mime type (case-insensitive)", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "image",
        url: "r2:chat/abc",
        mimeType: "IMAGE/HEIF",
      })
    ).toBe(true);
  });

  test("matches by .heic url extension when mime type is missing", () => {
    expect(
      isConvertibleHeicAttachment({ type: "image", url: "r2:chat/abc-IMG.HEIC" })
    ).toBe(true);
  });

  test("matches by .heif file name extension", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "image",
        url: "r2:chat/abc",
        name: "vacation.heif",
      })
    ).toBe(true);
  });

  test("ignores non-image attachments even if .heic", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "file",
        url: "r2:chat/abc.heic",
        mimeType: "image/heic",
      })
    ).toBe(false);
  });

  test("ignores already-JPEG images", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "image",
        url: "r2:chat/abc-photo.jpg",
        mimeType: "image/jpeg",
      })
    ).toBe(false);
  });

  test("does not match .heic appearing mid-string (not an extension)", () => {
    expect(
      isConvertibleHeicAttachment({
        type: "image",
        url: "r2:chat/abc.heic.jpg",
        mimeType: "image/jpeg",
      })
    ).toBe(false);
  });
});

describe("jpegFileName", () => {
  test("swaps .heic for .jpg, preserving the base name", () => {
    expect(jpegFileName({ name: "IMG_9990.heic" }, "chat/uuid-IMG_9990.heic")).toBe(
      "IMG_9990.jpg"
    );
  });

  test("is case-insensitive on the extension", () => {
    expect(jpegFileName({ name: "Photo.HEIF" }, "chat/uuid-Photo.HEIF")).toBe(
      "Photo.jpg"
    );
  });

  test("falls back to the key's file name when no name is set", () => {
    expect(jpegFileName({ url: "r2:chat/uuid-pic.heic" }, "chat/uuid-pic.heic")).toBe(
      "uuid-pic.jpg"
    );
  });

  test("appends .jpg when there is no recognizable extension", () => {
    expect(jpegFileName({ name: "snapshot" }, "chat/uuid-snapshot")).toBe(
      "snapshot.jpg"
    );
  });
});
