import { describe, expect, it } from "vitest";
import { overlayRedirect } from "./overlay-guard";

const path = "/t/local/p/interview/live/overlay";
const go = (search: string) => overlayRedirect({ search, pathname: path });

describe("a browser tab on the overlay route", () => {
  it("goes to /live", () => {
    expect(go("")).toBe("/t/local/p/interview/live");
    expect(go("?host=bogus")).toBe("/t/local/p/interview/live");
  });
  it("is no longer a host once it was the web app, the float or a window", () => {
    for (const search of ["?host=pwa", "?host=pip", "?host=window"])
      expect(go(search)).toBe("/t/local/p/interview/live");
  });
  it("keeps a requested session", () => {
    expect(go("?session=abc")).toBe("/t/local/p/interview/live?session=abc");
  });
  it("stays for the native shell and its panels", () => {
    for (const search of ["?host=native", "?panel=single", "?panel=settings"])
      expect(go(search)).toBeNull();
  });
});
