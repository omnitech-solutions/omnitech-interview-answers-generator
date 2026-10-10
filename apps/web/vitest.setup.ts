// oxlint-disable-next-line import/no-unassigned-import -- installs RTL matchers
import "@testing-library/jest-dom/vitest";

import { setDefaultEngineLog } from "@omnitech/ai-engine";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// An engine a test builds with no `log` stays quiet (the engine logs by
// default; `engineLog` is silent under NODE_ENV=test for the Studio's own).
setDefaultEngineLog({ level: "silent" });

// Node 25's experimental Web Storage global can shadow jsdom with an unusable
// instance unless --localstorage-file is configured. Keep browser tests
// deterministic without requiring callers or Git hooks to change NODE_OPTIONS.
// Route handlers and server modules run in Node (no window) instead.
if (
  typeof window !== "undefined" &&
  typeof window.localStorage?.getItem !== "function"
) {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

afterEach(() => {
  cleanup();
});
