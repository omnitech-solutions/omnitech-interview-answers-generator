import { describe, expect, it } from "vitest";

import {
  returnTargetLabel,
  safeReturnTarget,
  signInPath,
  withSignedInMarker,
} from "./return-target";

describe("safeReturnTarget", () => {
  it.each([
    ["/t/local/p/interview/live", "/t/local/p/interview/live"],
    ["/t/local", "/t/local"],
    [
      "/t/acme/p/interview/work?artifact=q-1",
      "/t/acme/p/interview/work?artifact=q-1",
    ],
    ["/t/local/p/interview#fragment", "/t/local/p/interview"],
  ])("keeps the same-origin tenant path %s", (input, expected) => {
    expect(safeReturnTarget(input)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/t/local"],
    ["a protocol-relative URL", "//evil.example/t/local"],
    ["a slash-backslash host", "/\\evil.example"],
    ["a backslash path", "/t/local\\..\\api"],
    ["javascript", "javascript:alert(1)"],
    ["a data URL", "data:text/html,x"],
    ["a path outside /t/", "/api/auth/signout"],
    ["the sign-in page itself", "/sign-in"],
    ["a dot-dot escape", "/t/../api/auth/signout"],
    ["an encoded dot-dot escape", "/t/%2e%2e/api"],
    ["a relative path", "t/local"],
    ["a newline", "/t/local\n/evil"],
    ["a carriage return", "/t/local\r"],
    ["a tab", "/t/local\t"],
    ["a NUL", "/t/local\0"],
    ["an encoded newline", "/t/local%0d%0aSet-Cookie:x=1"],
    ["an encoded backslash", "/t/local/%5c"],
    ["an encoded slash prefix", "/%2f%2fevil.example"],
    ["an empty string", ""],
    ["whitespace", "  "],
    ["a very long path", `/t/${"a".repeat(3000)}`],
  ])("refuses %s", (_name, input) => {
    expect(safeReturnTarget(input)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(safeReturnTarget(undefined)).toBeNull();
    expect(safeReturnTarget(null)).toBeNull();
    expect(safeReturnTarget(["/t/local", "/t/other"])).toBeNull();
    expect(safeReturnTarget(42)).toBeNull();
  });
});

describe("signInPath", () => {
  it("names the sign-in page, carrying a safe target encoded", () => {
    expect(signInPath("/t/local/p/interview/live?x=1")).toBe(
      "/sign-in?next=%2Ft%2Flocal%2Fp%2Finterview%2Flive%3Fx%3D1",
    );
  });
  it("drops an unsafe target and adds the expired reason on request", () => {
    expect(signInPath("https://evil.example")).toBe("/sign-in");
    expect(signInPath("/t/local", { expired: true })).toBe(
      "/sign-in?next=%2Ft%2Flocal&reason=expired",
    );
    expect(signInPath(undefined, { expired: true })).toBe(
      "/sign-in?reason=expired",
    );
  });
});

describe("withSignedInMarker", () => {
  it("adds the provider that just signed in, once, to a safe path", () => {
    expect(withSignedInMarker("/t/local/p/interview/live", "google")).toBe(
      "/t/local/p/interview/live?signed-in=google",
    );
    expect(withSignedInMarker("/t/local/p/interview?a=1", "local")).toBe(
      "/t/local/p/interview?a=1&signed-in=local",
    );
  });
  it("falls back to the home route when there is no safe target", () => {
    expect(withSignedInMarker(null, "linkedin")).toBe(
      "/t/local/p/interview?signed-in=linkedin",
    );
  });
});

describe("returnTargetLabel", () => {
  it("names a known studio view", () => {
    expect(returnTargetLabel("/t/local/p/interview/live")).toBe("Live session");
    expect(returnTargetLabel("/t/local/p/interview/rehearsal")).toBe(
      "Rehearsal",
    );
  });
  it("names the product's home, and any other path plainly", () => {
    expect(returnTargetLabel("/t/local/p/interview")).toBe("Interview Studio");
    expect(returnTargetLabel("/t/local/settings/integrations")).toBe(
      "the page you asked for",
    );
  });
});
