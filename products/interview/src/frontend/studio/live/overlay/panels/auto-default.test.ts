import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handsFreeHost,
  loadAutoPreferred,
  saveAutoPreferred,
} from "../auto-prefs";

const at = (search: string) =>
  window.history.replaceState({}, "", `/live${search}`);
afterEach(() => {
  delete (window as { studioHost?: unknown }).studioHost;
  window.localStorage.clear();
  at("");
});
beforeEach(() => {
  window.localStorage.clear();
  at("");
});

describe("Auto by default", () => {
  it("is off in a plain tab nobody opted in, and on once the owner opted in", () => {
    expect(handsFreeHost()).toBe(false);
    expect(loadAutoPreferred("t")).toBe(false);
    saveAutoPreferred("t", true);
    expect(loadAutoPreferred("t")).toBe(true);
  });
  it("is on by default in the hands-free hosts: pip, native, handsfree=1, the shell's minified mode, the native bridge", () => {
    for (const search of ["?host=pip", "?host=native", "?handsfree=1"]) {
      at(search);
      expect(loadAutoPreferred("t")).toBe(true);
    }
    at("");
    (window as { studioHost?: unknown }).studioHost = {
      presentation: { appMode: () => "minified" },
    };
    expect(loadAutoPreferred("t")).toBe(true);
    (window as { studioHost?: unknown }).studioHost = {};
    expect(loadAutoPreferred("t")).toBe(true);
  });
  it("is off in a hands-free host only when the owner turned it off", () => {
    at("?host=native&handsfree=1");
    saveAutoPreferred("t", false);
    expect(loadAutoPreferred("t")).toBe(false);
  });
});
