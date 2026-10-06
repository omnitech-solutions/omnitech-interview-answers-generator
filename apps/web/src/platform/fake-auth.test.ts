import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowLocalSignIn,
  isLoopbackHost,
  localSignInAvailable,
} from "./fake-auth";

afterEach(() => vi.unstubAllEnvs());

const request = (headers: Record<string, string>) => new Headers(headers);

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3100",
    "[::1]",
    "[::1]:3000",
    "LOCALHOST:3000",
  ])("accepts %s", (host) => expect(isLoopbackHost(host)).toBe(true));
  it.each([
    "studio.example.com",
    "studio.example.com:3000",
    "localhost.evil.com",
    "evil.com/localhost",
    "127.0.0.1.evil.com",
    "127.0.0.2",
    "0.0.0.0",
    "192.168.1.5:3000",
    "[::2]",
    "user@localhost",
    "",
    "localhost:abc",
  ])("refuses %s", (host) => expect(isLoopbackHost(host)).toBe(false));
  it("refuses a missing host", () => {
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});

describe("localSignInAvailable", () => {
  it("needs FAKE_AUTH_ENABLED and a loopback host", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(localSignInAvailable(request({ host: "localhost:3000" }))).toBe(
      true,
    );
    expect(localSignInAvailable(request({ host: "studio.example.com" }))).toBe(
      false,
    );
  });
  it("is off without FAKE_AUTH_ENABLED, even on loopback", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "false");
    expect(localSignInAvailable(request({ host: "localhost:3000" }))).toBe(
      false,
    );
    vi.stubEnv("FAKE_AUTH_ENABLED", "");
    expect(localSignInAvailable(request({ host: "localhost:3000" }))).toBe(
      false,
    );
  });
  it("is off when a proxy forwarded the request from elsewhere", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(
      localSignInAvailable(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "studio.example.com",
        }),
      ),
    ).toBe(false);
    expect(
      localSignInAvailable(
        request({ host: "localhost:3000", "x-forwarded-for": "203.0.113.9" }),
      ),
    ).toBe(false);
    expect(
      localSignInAvailable(
        request({
          host: "localhost:3000",
          "x-forwarded-for": "::1, 203.0.113.9",
        }),
      ),
    ).toBe(false);
  });
  it("accepts a forwarded header that is itself loopback", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(
      localSignInAvailable(
        request({
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-for": "127.0.0.1",
        }),
      ),
    ).toBe(true);
  });
});

// Docker publishes the port on 127.0.0.1 only, but inside the container every
// client arrives from the bridge gateway (172.x), which Next reports as
// X-Forwarded-For; without an operator assertion the local sign-in was off for
// the person sitting at this machine. The assertion ignores only the forwarded
// client address: a non-loopback Host, or a public forwarded host from a real
// reverse proxy, still turns the offer off.
describe("localSignInAvailable with AUTH_ASSUME_LOOPBACK_CLIENTS", () => {
  const viaDockerGateway = {
    host: "127.0.0.1:3000",
    "x-forwarded-for": "172.23.0.1",
  };
  it("is off for a gateway client by default", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(localSignInAvailable(request(viaDockerGateway))).toBe(false);
  });
  it("offers the sign-in to a gateway client once the operator asserts it", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    vi.stubEnv("AUTH_ASSUME_LOOPBACK_CLIENTS", "true");
    expect(localSignInAvailable(request(viaDockerGateway))).toBe(true);
    expect(allowLocalSignIn(request(viaDockerGateway))).toBe(true);
  });
  it("never overrides a non-loopback Host, a public forwarded host, or a missing flag", () => {
    vi.stubEnv("AUTH_ASSUME_LOOPBACK_CLIENTS", "true");
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(
      localSignInAvailable(
        request({
          host: "studio.example.com",
          "x-forwarded-for": "172.23.0.1",
        }),
      ),
    ).toBe(false);
    expect(
      localSignInAvailable(
        request({
          ...viaDockerGateway,
          "x-forwarded-host": "studio.example.com",
        }),
      ),
    ).toBe(false);
    vi.stubEnv("FAKE_AUTH_ENABLED", "false");
    expect(localSignInAvailable(request(viaDockerGateway))).toBe(false);
  });
  it("only the exact value `true` counts", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    for (const value of ["1", "yes", "TRUE", ""]) {
      vi.stubEnv("AUTH_ASSUME_LOOPBACK_CLIENTS", value);
      expect(localSignInAvailable(request(viaDockerGateway))).toBe(false);
    }
  });
});

describe("allowLocalSignIn (the local provider's authorize rule)", () => {
  it("lets a loopback request in and refuses any other", () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    expect(allowLocalSignIn(request({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(allowLocalSignIn(request({ host: "studio.example.com" }))).toBe(
      false,
    );
    expect(allowLocalSignIn(undefined)).toBe(false);
  });
});
