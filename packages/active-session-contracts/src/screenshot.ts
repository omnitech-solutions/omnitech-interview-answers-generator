export type ScreenshotMediaType = "image/png" | "image/jpeg" | "image/webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

// Screenshots are accepted by leading bytes, never by a declared type or file
// name. SVG, HTML, scripts and everything else are refused (returns null).
export function detectScreenshotMediaType(
  bytes: Uint8Array,
): ScreenshotMediaType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  // WebP is a RIFF container: "RIFF" <size> "WEBP".
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}
