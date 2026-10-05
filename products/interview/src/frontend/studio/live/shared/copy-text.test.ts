import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy-text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const withClipboard = (writeText: (text: string) => Promise<void>) =>
  vi.stubGlobal("navigator", { clipboard: { writeText } });

describe("copyText", () => {
  it("is true only after the clipboard write resolved", async () => {
    const writeText = vi.fn(async () => undefined);
    withClipboard(writeText);
    expect(await copyText("answer")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("answer");
  });

  it("falls back to a selection copy when the clipboard refuses", async () => {
    withClipboard(async () => {
      throw new Error("denied");
    });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: exec,
      configurable: true,
    });
    expect(await copyText("answer")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("is false when neither route copied", async () => {
    withClipboard(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    expect(await copyText("answer")).toBe(false);
  });

  it("is false when the fallback itself throws", async () => {
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", {
      value: () => {
        throw new Error("unsupported");
      },
      configurable: true,
    });
    expect(await copyText("answer")).toBe(false);
  });
});
