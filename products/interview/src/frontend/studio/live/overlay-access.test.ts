// When the overlay page may show the session: signed out, unavailable (a
// tenant mismatch, a 404/403 or a purged session), or fine (including no
// session at all and a finished session the owner switched to).
import { describe, expect, it } from "vitest";
import { overlayAccess } from "./overlay-access";
import type { LiveSnapshot } from "./session-snapshot";

const snap = (over: Partial<LiveSnapshot> = {}): LiveSnapshot =>
  ({
    tenant: "local",
    hydration: "ready",
    session: null,
    switchedTo: null,
    streamError: null,
    commandError: null,
    ...over,
  }) as unknown as LiveSnapshot;
const session = (over: Record<string, unknown> = {}) =>
  ({ id: "s1", status: "active", purged: false, ...over }) as never;

describe("overlayAccess", () => {
  it("is ok with no session: the page shows an empty state", () => {
    expect(overlayAccess(snap(), "local")).toBe("ok");
  });
  it("is ok for a live session", () => {
    expect(overlayAccess(snap({ session: session() }), "local")).toBe("ok");
  });
  it("is unavailable when the page belongs to another tenant", () => {
    expect(overlayAccess(snap({ tenant: "other" }), "local")).toBe(
      "unavailable",
    );
  });
  it("is signed out on a 401 from the stream or from a command", () => {
    expect(overlayAccess(snap({ streamError: "unauthorized" }), "local")).toBe(
      "signed-out",
    );
    expect(overlayAccess(snap({ commandError: "unauthorized" }), "local")).toBe(
      "signed-out",
    );
  });
  it("is unavailable on a stream 404 or 403", () => {
    expect(overlayAccess(snap({ streamError: "not_found" }), "local")).toBe(
      "unavailable",
    );
    expect(
      overlayAccess(snap({ streamError: "origin_forbidden" }), "local"),
    ).toBe("unavailable");
  });
  it("does not end on a command 404, which can mean a missing route", () => {
    expect(overlayAccess(snap({ commandError: "not_found" }), "local")).toBe(
      "ok",
    );
  });
  it("is unavailable for a purged session that was not chosen", () => {
    expect(
      overlayAccess(snap({ session: session({ purged: true }) }), "local"),
    ).toBe("unavailable");
  });
  it("keeps a finished session the owner switched to, even when its stream answers 404", () => {
    expect(
      overlayAccess(
        snap({
          session: session({ status: "ended", purged: true }),
          switchedTo: "s1",
          streamError: "not_found",
        }),
        "local",
      ),
    ).toBe("ok");
  });
  it("still ends a switched-to session on sign-out", () => {
    expect(
      overlayAccess(
        snap({
          session: session({ status: "ended" }),
          switchedTo: "s1",
          streamError: "unauthorized",
        }),
        "local",
      ),
    ).toBe("signed-out");
  });
});
