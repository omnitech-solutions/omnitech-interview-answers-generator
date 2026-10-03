import { describe, expect, it } from "vitest";
import {
  commandMessage,
  fallbackTitle,
  sourceChips,
  stateView,
} from "./session-bar-model";
import {
  disconnected,
  gap,
  minutesAfter,
  sessionView,
  transcript,
} from "./session-fixtures";
import { deriveLiveModel } from "./session-state";

const NOW = Date.parse(minutesAfter(1));
function model(
  overrides = {},
  observations: Parameters<typeof deriveLiveModel>[0]["observations"] = [],
) {
  return deriveLiveModel({
    session: sessionView({
      lastHeartbeatAt: minutesAfter(1),
      ...overrides,
    }),
    observations,
    actions: [],
    serverClockOffsetMs: 0,
    nowMs: NOW,
  });
}

describe("session bar state", () => {
  it("is Live with a pulse while capture is healthy", () => {
    expect(stateView(model())).toMatchObject({
      key: "live",
      label: "Live",
      tone: "red",
      pulse: true,
      bordered: false,
    });
  });
  it("is Paused in amber without a pulse", () => {
    expect(stateView(model({ status: "paused" }))).toMatchObject({
      key: "paused",
      label: "Paused",
      tone: "amber",
      pulse: false,
    });
  });
  it("is Source lost with a red border when app audio is disconnected", () => {
    expect(
      stateView(
        model({}, [disconnected(1, "application-audio", "device-lost")]),
      ),
    ).toMatchObject({
      key: "source-lost",
      label: "Source lost",
      tone: "red",
      bordered: true,
    });
  });
  it("names the microphone and the screen when their capture is lost", () => {
    expect(
      stateView(model({}, [disconnected(1, "microphone", "error")])).label,
    ).toBe("Microphone capture lost");
    expect(
      stateView(
        model({ captureSources: ["screen"] }, [
          disconnected(1, "screen", "user-stopped"),
        ]),
      ).label,
    ).toBe("Screen capture lost");
  });
  it("gives a revoked permission its own amber label", () => {
    expect(
      stateView(
        model({}, [disconnected(1, "microphone", "permission-revoked")]),
      ),
    ).toMatchObject({
      key: "permission-revoked",
      label: "Permission revoked",
      tone: "amber",
      bordered: true,
    });
  });
  it("says the companion is offline only after contact went quiet", () => {
    expect(
      stateView(model({ lastHeartbeatAt: minutesAfter(-5) })),
    ).toMatchObject({ key: "companion-offline", label: "Companion offline" });
  });
  it("waits for the companion when the server has recorded no contact", () => {
    const view = stateView(model({ lastHeartbeatAt: null, status: "created" }));
    expect(view).toMatchObject({
      key: "waiting",
      label: "Waiting for companion",
      pulse: false,
    });
    expect(
      stateView(model({ lastHeartbeatAt: null, status: "active" })).key,
    ).toBe("waiting");
  });
  it("lets a pause outrank a lost source", () => {
    expect(
      stateView(
        model({ status: "paused" }, [
          disconnected(1, "application-audio", "error"),
        ]),
      ).key,
    ).toBe("paused");
  });
});

describe("source chips", () => {
  it("lists only the selected sources, titled with their state", () => {
    const chips = sourceChips(
      model({}, [transcript(1, "Hello there", { sourceId: "microphone" })]),
    );
    expect(chips.map((chip) => chip.title)).toEqual([
      "Microphone · receiving",
      "App audio · receiving",
    ]);
  });
  it("never says receiving while the companion is not in contact", () => {
    const chips = sourceChips(model({ lastHeartbeatAt: null }));
    expect(chips.map((chip) => chip.title)).toEqual([
      "Microphone · waiting for the companion",
      "App audio · waiting for the companion",
    ]);
    const quiet = sourceChips(
      model({ lastHeartbeatAt: minutesAfter(-5) }, [
        transcript(1, "Hello there", { sourceId: "microphone" }),
      ]),
    );
    expect(quiet[0]?.title).toBe("Microphone · no recent contact");
  });
  it("marks a lost chip red and a revoked permission amber with its reason", () => {
    const chips = sourceChips(
      model({}, [
        disconnected(1, "application-audio", "device-lost"),
        disconnected(2, "microphone", "permission-revoked"),
      ]),
    );
    expect(chips[0]).toMatchObject({
      source: "microphone",
      tone: "amber",
      reason: "permission-revoked",
    });
    expect(chips[0]?.title).toContain("permission revoked");
    expect(chips[1]).toMatchObject({
      source: "application-audio",
      tone: "red",
    });
    expect(chips[1]?.title).toBe("App audio · disconnected, device lost");
  });
  it("shows a dropped-audio gap as amber", () => {
    const chips = sourceChips(
      model({}, [gap(1, "application-audio", "buffer-overflow", 4000)]),
    );
    expect(chips[1]).toMatchObject({ tone: "amber" });
    expect(chips[1]?.title).toBe("App audio · audio dropped for 4 s");
  });
});

describe("when the session service cannot be read", () => {
  // Contact was recorded 1.5 minutes before the last read (online then) and
  // 2.5 minutes before now (offline, had this been a fresh read).
  const stale = (overrides: Record<string, unknown> = {}) =>
    deriveLiveModel({
      session: sessionView({
        lastHeartbeatAt: minutesAfter(-1, -30),
        ...overrides,
      }),
      observations: [],
      actions: [],
      serverClockOffsetMs: 0,
      nowMs: NOW,
      lastReadAt: NOW - 60_000,
      streamError: "network",
    });

  it("shows an amber unreachable state and banner instead of Live", () => {
    const view = stale();
    expect(stateView(view)).toMatchObject({
      key: "unreachable",
      label: "Can't reach Studio",
      tone: "amber",
      pulse: false,
    });
    expect(view.banners[0]).toMatchObject({
      kind: "stream-unreachable",
      tone: "amber",
    });
  });

  it("does not call the companion offline: that needs a fresh read", () => {
    const view = stale();
    expect(view.companion.status).toBe("online");
    expect(view.banners.map((b) => b.kind)).not.toContain("companion-offline");
  });

  it("stops the elapsed clock at the last read", () => {
    const view = stale({ createdAt: minutesAfter(-10) });
    expect(view.elapsedMs).toBe(NOW - 60_000 - Date.parse(minutesAfter(-10)));
  });

  it("also goes stale when reads simply stop arriving, with no error recorded", () => {
    const view = deriveLiveModel({
      session: sessionView({ lastHeartbeatAt: minutesAfter(1) }),
      observations: [],
      actions: [],
      serverClockOffsetMs: 0,
      nowMs: NOW,
      lastReadAt: NOW - 60_000,
      streamError: null,
    });
    expect(stateView(view).key).toBe("unreachable");
  });

  it("is fresh while reads keep arriving", () => {
    const view = deriveLiveModel({
      session: sessionView({ lastHeartbeatAt: minutesAfter(1) }),
      observations: [],
      actions: [],
      serverClockOffsetMs: 0,
      nowMs: NOW,
      lastReadAt: NOW - 2_000,
      streamError: null,
    });
    expect(stateView(view).key).toBe("live");
    expect(view.banners).toEqual([]);
  });

  it("says nothing of it once the session has ended", () => {
    const view = stale({ status: "ended", endedAt: minutesAfter(0) });
    expect(view.banners).toEqual([]);
  });
});

describe("copy", () => {
  it("maps every command failure to a fixed sentence", () => {
    expect(commandMessage("status_refused")).toMatch(/can.t be resumed/i);
    expect(commandMessage("duration_cap_reached")).toMatch(/time limit/i);
    expect(commandMessage("network")).toMatch(/reach/i);
    expect(commandMessage("job_cancellation_failed")).toMatch(/cancel/i);
    expect(commandMessage("session_unavailable")).toMatch(/try again/i);
  });
  it("falls back to Rehearsal without a link and Live session with one", () => {
    expect(fallbackTitle(sessionView())).toBe("Rehearsal");
    expect(fallbackTitle(sessionView({ interviewId: "i-1" }))).toBe(
      "Live session",
    );
  });
});
