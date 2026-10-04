// A native shell window paints translucent surfaces and follows the shell's
// opacity; a tab and a PiP window are untouched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installHostSurface,
  isNativeSurface,
  OPACITY_POLL_MS,
} from "./host-surface";

const here = (name: string) => join(__dirname, name);
const root = document.documentElement;

const bridge = (opacity: () => number) => {
  (window as { studioHost?: unknown }).studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: [],
    captureScreen: async () => ({ ok: false, reason: "unsupported" }),
    pinOnTop: async () => true,
    openExternal: async () => undefined,
    onHotkey: () => () => undefined,
    presentation: {
      capabilities: [],
      open: async () => true,
      close: async () => true,
      focus: async () => true,
      openPanels: () => [],
      setLayout: async () => true,
      setVisible: async () => true,
      interactionMode: () => true,
      setInteractionMode: async () => true,
      onInteractionMode: () => () => undefined,
      opacity,
    },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (window as { studioHost?: unknown }).studioHost;
  root.removeAttribute("data-panel-host");
  root.style.removeProperty("--ov-alpha");
});

describe("installHostSurface", () => {
  it("reads the shell's opacity into --ov-alpha and follows a change", () => {
    let opacity = 0.8;
    bridge(() => opacity);
    const remove = installHostSurface(true);
    expect(root.getAttribute("data-panel-host")).toBe("native");
    expect(root.style.getPropertyValue("--ov-alpha")).toBe("0.8");
    opacity = 0.4;
    vi.advanceTimersByTime(OPACITY_POLL_MS);
    expect(root.style.getPropertyValue("--ov-alpha")).toBe("0.4");
    remove();
    expect(root.hasAttribute("data-panel-host")).toBe(false);
    expect(root.style.getPropertyValue("--ov-alpha")).toBe("");
  });
  it("keeps the value within the shell's range", () => {
    bridge(() => 0.01);
    installHostSurface(true);
    expect(root.style.getPropertyValue("--ov-alpha")).toBe("0.3");
  });
  it("sets no variable for a plain window", () => {
    bridge(() => 0.5);
    installHostSurface(false);
    expect(root.getAttribute("data-panel-host")).toBe("window");
    expect(root.style.getPropertyValue("--ov-alpha")).toBe("");
  });
});

describe("isNativeSurface", () => {
  it("is native for host=native or a bridge, never for PiP or a plain tab", () => {
    expect(isNativeSurface(new URLSearchParams("host=native"))).toBe(true);
    expect(isNativeSurface(new URLSearchParams(""))).toBe(false);
    bridge(() => 1);
    expect(isNativeSurface(new URLSearchParams(""))).toBe(true);
    expect(isNativeSurface(new URLSearchParams("host=pip"))).toBe(false);
  });
});

describe("the native-host stylesheet", () => {
  const css = ["overlay.css", "panels/panels.css", "code-canvas.css"]
    .map((name) => readFileSync(here(name), "utf8"))
    .join("\n");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
  const native = rules.filter((rule) =>
    rule.selector.includes('[data-panel-host="native"]'),
  );

  it("paints no native-host surface with a solid colour", () => {
    expect(native.length).toBeGreaterThan(5);
    for (const rule of native)
      for (const [, value] of rule.body.matchAll(
        /background(?:-color)?:([^;]+);/g,
      ))
        expect(value, rule.selector).not.toMatch(
          /#[0-9a-f]{3,8}\b|(?<![a-z])rgb\(|oklch\(|\bwhite\b|\bblack\b/i,
        );
  });
  it("makes every card, pill, menu and the code canvas translucent with a blur", () => {
    const text = native
      .map((rule) => `${rule.selector}{${rule.body}}`)
      .join("\n");
    for (const surface of [
      ".ov-card",
      ".pn-card",
      ".pn-pill",
      ".ov-menu",
      ".lc-canvas",
    ])
      expect(text).toContain(surface);
    expect(text).toMatch(/backdrop-filter: blur/);
    expect(text).toMatch(/--lc-surface: rgba\(/);
  });
  it("makes the html, body, root and panels transparent", () => {
    const text = native
      .map((rule) => `${rule.selector}{${rule.body}}`)
      .join("\n");
    expect(text).toMatch(/\[data-panel-host="native"\] body/);
    expect(text).toMatch(/\.pn-root[\s\S]*background: transparent/);
  });
  it("keeps the surface tint dense enough for AA text, and lifts muted text", () => {
    const floor = [...css.matchAll(/--ov-a: max\(([0-9.]+),/g)].map((m) =>
      Number(m[1]),
    );
    expect(floor.length).toBeGreaterThan(0);
    for (const value of floor) expect(value).toBeGreaterThanOrEqual(0.6);
    expect(css).toMatch(/text-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.5/);
    expect(css).toMatch(/--ov-muted: rgba\(255, 255, 255, 0\.84\)/);
  });
  it("leaves the plain tab appearance on the unconditional rules", () => {
    expect(css).toMatch(/\.ov-root \{[^}]*background: #14141a/);
  });
});
