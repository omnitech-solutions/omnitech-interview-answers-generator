import { afterEach, describe, expect, it, vi } from "vitest";
import { stored } from "./stored";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});
describe("stored preferences", () => {
  it("round trips and clears using the unchanged key", () => {
    const mode = stored("creation-mode", ["ai", "manual"], "ai");
    expect(mode.read()).toBe("ai");
    mode.write("manual");
    expect(window.localStorage.getItem("creation-mode")).toBe("manual");
    expect(mode.read()).toBe("manual");
    mode.clear();
    expect(mode.read()).toBe("ai");
    expect(window.localStorage.getItem("creation-mode")).toBeNull();
  });

  it("ignores unknown stored values and invalid writes from untyped callers", () => {
    const mode = stored("creation-mode", ["ai", "manual"], "ai");
    window.localStorage.setItem("creation-mode", "obsolete");
    expect(mode.read()).toBe("ai");
    mode.write("manual");
    mode.write("obsolete" as "ai");
    expect(mode.read()).toBe("manual");
  });

  it("tolerates an inaccessible storage object", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    const mode = stored("mode", ["on", "off"], "off");
    expect(mode.read()).toBe("off");
    expect(() => mode.write("on")).not.toThrow();
    expect(() => mode.clear()).not.toThrow();
  });

  it("tolerates quota and operation failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const mode = stored("mode", ["on", "off"], "off");
    expect(mode.read()).toBe("off");
    expect(() => mode.write("on")).not.toThrow();
    expect(() => mode.clear()).not.toThrow();
  });

  it("can be created and used without a browser", () => {
    vi.stubGlobal("window", undefined);
    const mode = stored("mode", ["on", "off"], "off");
    expect(mode.read()).toBe("off");
    expect(() => mode.write("on")).not.toThrow();
    expect(() => mode.clear()).not.toThrow();
  });
});
