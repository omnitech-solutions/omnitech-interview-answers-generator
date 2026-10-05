import { afterEach, expect, it, vi } from "vitest";
import { safeStorage } from "./safe-storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("reads and writes the browser's storage", () => {
  const storage = safeStorage("local");
  storage.set("k", "v");
  expect(window.localStorage.getItem("k")).toBe("v");
  expect(storage.get("k")).toBe("v");
  storage.remove("k");
  expect(window.localStorage.getItem("k")).toBeNull();
  expect(storage.get("k")).toBeNull();
});

it("keeps working in memory when storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const storage = safeStorage("session");
  expect(() => storage.set("blocked", "kept")).not.toThrow();
  expect(storage.get("blocked")).toBe("kept");
  expect(() => storage.remove("blocked")).not.toThrow();
  expect(storage.get("blocked")).toBeNull();
});
