import { describe, expect, it } from "vitest";
import { overlayRedirect } from "../overlay-guard";

const path = "/t/local/p/interview/live/overlay";
const go = (search: string, standalone = false) =>
  overlayRedirect({ search, pathname: path, standalone });

describe("a browser tab on the overlay route", () => {
  it("goes to /live", () => {
    expect(go("")).toBe("/t/local/p/interview/live");
    expect(go("?host=pwa")).toBe("/t/local/p/interview/live");
    expect(go("?host=bogus")).toBe("/t/local/p/interview/live");
  });
  it("keeps a requested session", () => {
    expect(go("?session=abc")).toBe("/t/local/p/interview/live?session=abc");
  });
  it("stays for hosts: pip, native, panels, window, and an installed app window", () => {
    for (const search of [
      "?host=pip",
      "?host=native",
      "?host=window",
      "?panel=pill",
    ])
      expect(go(search)).toBeNull();
    expect(go("?host=pwa", true)).toBeNull();
  });
});
