// Moves a directory aside for the duration of a task and always puts it back.
//
// Crux's derive-arch scans the working tree and ignores .gitignore, so a
// generated, git-ignored directory such as apps/web/public/ocr (the text
// recognition engine files) shows up in bionic/arch and looks like drift.
// `pnpm docs:arch` and `docs:arch:check` hide it with withAside() while the
// scanner runs.
//
// The directory is renamed, never copied or deleted, so it cannot be lost:
// - it is restored in a finally block (success or failure of the task);
// - it is restored on SIGINT and SIGTERM, then the process exits;
// - if an earlier run died without restoring (SIGKILL, power loss), the next
//   call restores that leftover first.
// The aside name sits beside the directory (same filesystem, so rename is
// atomic), as `<name>.docs-arch-aside`.
import { existsSync, renameSync } from "node:fs";

export const asideName = (dir) => `${dir}.docs-arch-aside`;

/** Puts `dir` back from its aside copy; a no-op when nothing is aside. */
export function restoreAside(dir) {
  const aside = asideName(dir);
  if (!existsSync(aside)) return;
  if (existsSync(dir)) {
    // Both exist: something recreated `dir` while it was aside. Keep both and
    // say so, rather than overwrite either.
    console.error(
      `docs-arch: ${dir} exists, so ${aside} was left in place; merge or remove it by hand.`,
    );
    return;
  }
  renameSync(aside, dir);
}

/**
 * Runs `task` with `dir` moved aside (if it exists) and restores it afterwards.
 * `onSignal(signal)` runs first on SIGINT/SIGTERM, so the caller can stop the
 * child process that is scanning the tree.
 */
export async function withAside(dir, task, onSignal = () => {}) {
  restoreAside(dir);
  const moved = existsSync(dir);
  if (moved) renameSync(dir, asideName(dir));
  const handlers = new Map();
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      onSignal(signal);
      restoreAside(dir);
      process.exit(code);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    return await task();
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    restoreAside(dir);
  }
}
