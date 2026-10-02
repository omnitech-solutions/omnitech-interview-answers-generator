import { useEffect, useRef } from "react";

export type ShortcutStep = { mod: boolean; shift: boolean; key: string };

const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  escape: "esc",
  arrowup: "↑",
  arrowdown: "↓",
};
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|ad)/.test(navigator.platform);

// "mod+shift+k" → one step; "g w" → two steps pressed in turn.
export function parseShortcut(shortcut: string): ShortcutStep[] {
  return shortcut.split(" ").map((step) => {
    const parts = step.toLowerCase().split("+");
    const key = parts.at(-1) ?? "";
    if (
      !key ||
      parts.slice(0, -1).some((part) => !["mod", "shift"].includes(part))
    )
      throw new Error(`Unsupported shortcut: ${shortcut}`);
    return { mod: parts.includes("mod"), shift: parts.includes("shift"), key };
  });
}

export function formatShortcut(shortcut: string) {
  return parseShortcut(shortcut)
    .map(
      (step) =>
        (step.mod ? (isMac() ? "⌘" : "Ctrl+") : "") +
        (step.shift ? "⇧" : "") +
        (KEY_LABELS[step.key] ?? step.key.toUpperCase()),
    )
    .join(" ");
}

const canonical = (step: ShortcutStep) =>
  `${step.mod ? "mod+" : ""}${step.shift ? "shift+" : ""}${step.key}`;
const fromEvent = (event: KeyboardEvent) =>
  canonical({
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    key: event.key.toLowerCase(),
  });

// Typing in a field never triggers a plain-key shortcut; ⌘-shortcuts still work.
function typingIn(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor",
    )
  );
}

const SEQUENCE_WINDOW_MS = 800;

export function useShortcuts(
  bindings: ReadonlyArray<{ shortcut: string; run(): void }>,
) {
  const latest = useRef(bindings);
  latest.current = bindings;
  useEffect(() => {
    // The steps of a sequence typed so far, e.g. ["g"] while waiting for "w".
    let typed: string[] = [];
    let typedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey) return;
      const prefix =
        event.timeStamp - typedAt <= SEQUENCE_WINDOW_MS ? typed : [];
      const sequence = [...prefix, fromEvent(event)];
      const typing = typingIn(event.target);
      const candidates = latest.current
        .map((binding) => ({
          binding,
          steps: parseShortcut(binding.shortcut).map(canonical),
        }))
        .filter(({ steps }) => !typing || steps[0]!.startsWith("mod+"));
      const startsWith = (steps: string[]) =>
        sequence.every((step, index) => steps[index] === step);
      const done = candidates.find(
        ({ steps }) => steps.length === sequence.length && startsWith(steps),
      );
      const partial = candidates.some(
        ({ steps }) => steps.length > sequence.length && startsWith(steps),
      );
      typed = !done && partial ? sequence : [];
      typedAt = event.timeStamp;
      if (done || partial) event.preventDefault();
      done?.binding.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
