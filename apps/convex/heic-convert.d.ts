/** Minimal types for the `heic-convert` package (ships no types). */
declare module "heic-convert" {
  interface ConvertOptions {
    /** Source HEIC/HEIF bytes. */
    buffer: ArrayBuffer | Uint8Array | Buffer;
    /** Output format. */
    format: "JPEG" | "PNG";
    /** JPEG quality 0..1 (ignored for PNG). */
    quality?: number;
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export default convert;
}
