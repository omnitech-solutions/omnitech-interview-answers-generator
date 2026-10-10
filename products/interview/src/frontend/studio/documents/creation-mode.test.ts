import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCreationMode, saveCreationMode } from "./creation-mode";

const KEY = "interview-studio.documents.creation-mode";

beforeEach(() => localStorage.clear());

describe("creation mode", () => {
  it("is AI until the person has chosen", () => {
    expect(loadCreationMode()).toBe("ai");
  });

  it("gives back the last choice saved in this browser", () => {
    saveCreationMode("manual");
    expect(localStorage.getItem(KEY)).toBe("manual");
    expect(loadCreationMode()).toBe("manual");
    saveCreationMode("ai");
    expect(loadCreationMode()).toBe("ai");
  });

  it("ignores a stored value that is not one of the two", () => {
    for (const stored of [
      "MANUAL",
      "manual ",
      "",
      "true",
      '{"mode":"manual"}',
    ]) {
      localStorage.setItem(KEY, stored);
      expect(loadCreationMode()).toBe("ai");
    }
  });

  it("works without storage: the default on read, nothing thrown on write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadCreationMode()).toBe("ai");
    expect(() => saveCreationMode("manual")).not.toThrow();
  });
});
