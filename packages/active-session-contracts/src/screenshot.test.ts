import { describe, expect, it } from "vitest";
import { detectScreenshotMediaType } from "./screenshot.js";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("detectScreenshotMediaType", () => {
  it("accepts PNG by leading bytes", () => {
    expect(
      detectScreenshotMediaType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0),
      ),
    ).toBe("image/png");
  });

  it("accepts JPEG by leading bytes", () => {
    expect(detectScreenshotMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
      "image/jpeg",
    );
  });

  it("accepts WebP by its RIFF and WEBP markers", () => {
    const webp = new Uint8Array([
      ...ascii("RIFF"),
      0x10,
      0,
      0,
      0,
      ...ascii("WEBPVP8 "),
    ]);
    expect(detectScreenshotMediaType(webp)).toBe("image/webp");
  });

  it.each([
    ["SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["XML-prefixed SVG", ascii('<?xml version="1.0"?><svg/>')],
    ["HTML", ascii("<html><script>alert(1)</script>")],
    ["GIF", ascii("GIF89a")],
    [
      "RIFF that is not WebP",
      new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVEfmt ")]),
    ],
    ["a PNG signature cut short", bytes(0x89, 0x50, 0x4e, 0x47)],
    ["empty", new Uint8Array()],
  ])("refuses %s", (_name, payload) => {
    expect(detectScreenshotMediaType(payload)).toBeNull();
  });
});
