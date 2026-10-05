import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_KEYS } from "../overlay/panels/commands";
import {
  NATIVE_SHORTCUTS,
  SHORTCUTS,
  shortcutsFor,
  WEB_SHORTCUTS,
} from "./shortcuts";

// The Mac shell's own table. Read as text: Swift stays its own source of truth
// and this test is the drift check between the two languages.
// Found from the workspace root, so the test passes from any directory vitest
// is started in.
function repoRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const HOTKEYS_SWIFT = join(
  repoRoot(process.cwd()),
  "apps/studio-shell/Sources/StudioShellCore/Hotkeys.swift",
);

type Binding = { action: string; label: string };

// Every `HotkeyBinding(action: .x, ... label: "...")`, split at the comment that
// opens the secondary aliases: what is above it is what the keys popover lists.
function registered(): { primary: Binding[]; all: Binding[] } {
  const source = readFileSync(HOTKEYS_SWIFT, "utf8");
  const [head = "", tail = ""] = source.split("// Secondary aliases.");
  const bindings = (text: string): Binding[] =>
    [
      ...text.matchAll(
        /HotkeyBinding\(action: \.(\w+),[^\n]*?label: "((?:[^"\\]|\\.)*)"/g,
      ),
    ].map(([, action = "", label = ""]) => ({
      action,
      label: label.replaceAll("\\\\", "\\"),
    }));
  return {
    primary: bindings(head),
    all: [...bindings(head), ...bindings(tail.split("\n]")[0] ?? "")],
  };
}

describe("shortcut parity with Hotkeys.swift", () => {
  it("reads the Swift table", () => {
    // Guard against the parser silently matching nothing.
    expect(registered().primary.length).toBeGreaterThanOrEqual(9);
  });

  it("every native chord in the table is registered by the shell", () => {
    const swift = new Set(registered().all.map((binding) => binding.label));
    const missing = NATIVE_SHORTCUTS.map((each) => each.chord).filter(
      (chord) => !swift.has(chord),
    );
    expect(missing).toEqual([]);
  });

  it("every primary chord the shell registers is in the table", () => {
    const table = new Set(NATIVE_SHORTCUTS.map((each) => each.chord));
    const unlisted = registered()
      .primary.map((binding) => binding.label)
      .filter((chord) => !table.has(chord));
    expect(unlisted).toEqual([]);
  });
});

describe("the shortcut table", () => {
  it("has unique ids per platform and one chord per entry", () => {
    for (const platform of ["native", "web"] as const) {
      const list = shortcutsFor(platform);
      expect(new Set(list.map((each) => each.id)).size).toBe(list.length);
      expect(new Set(list.map((each) => each.chord)).size).toBe(list.length);
    }
  });

  it("carries the web page's own bindings from the keymap it matches against", () => {
    expect(WEB_SHORTCUTS.map((each) => each.chord)).toEqual(
      COMMAND_KEYS.map((each) => each.keys),
    );
    expect(SHORTCUTS).toHaveLength(
      NATIVE_SHORTCUTS.length + WEB_SHORTCUTS.length,
    );
  });

  it("includes the eight design shortcuts", () => {
    const chords = NATIVE_SHORTCUTS.map((each) => each.chord);
    for (const chord of [
      "⌘⇧S",
      "⌥R",
      "⌘⇧I",
      "⌘⇧V",
      "⌘⇧C",
      "⌘↑",
      "⌘↓",
      "⌥⇧U",
      "⌘,",
    ])
      expect(chords).toContain(chord);
  });
});
