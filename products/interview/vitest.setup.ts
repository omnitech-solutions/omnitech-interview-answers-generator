import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The default 1 s wait for findBy/waitFor is too tight when hundreds of test
// files run in parallel (dynamic imports such as Mermaid can take longer); it
// stays inside the 10 s test timeout set in vitest.config.ts.
configure({ asyncUtilTimeout: 5_000 });

// A test that opts into the node environment (the real-stream test, which needs
// PostgreSQL) has no window to patch.
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

// Radix (the component library's menus, popovers and tooltips) measures and
// captures pointers; jsdom has neither.
if (typeof window !== "undefined") {
  const win = window as unknown as Record<string, unknown>;
  win.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}
