import { ACTIVE_SESSION_LIMITS } from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import {
  disconnected,
  gap,
  minutesAfter,
  sessionView,
  snapshot,
  stored,
  transcript,
} from "./session-fixtures";
import {
  COMPANION_OFFLINE_AFTER_MS,
  CREDENTIAL_EXPIRING_SOON_MS,
  CREDENTIAL_LIFETIME_MS,
  companionModel,
  type SourceHealth,
  sourceIndex,
  sourceStatuses,
} from "./session-sources";

const health = (
  observations: Parameters<typeof sourceStatuses>[1],
  options: {
    sources?: ("microphone" | "application-audio" | "screen")[];
    contact?: boolean;
  } = {},
) => {
  const session = sessionView({
    captureSources: options.sources ?? [
      "microphone",
      "application-audio",
      "screen",
    ],
  });
  return Object.fromEntries(
    sourceStatuses(session, observations, options.contact ?? false).map((s) => [
      s.source,
      s.health,
    ]),
  ) as Record<"microphone" | "application-audio" | "screen", SourceHealth>;
};

describe("source health", () => {
  it("marks what the session did not choose as not selected", () => {
    expect(health([], { sources: ["microphone"] })).toEqual({
      microphone: "waiting",
      "application-audio": "not-selected",
      screen: "not-selected",
    });
  });

  it("does not claim receiving before anything is heard or companion contact", () => {
    expect(health([])).toEqual({
      microphone: "waiting",
      "application-audio": "waiting",
      screen: "waiting",
    });
    expect(health([], { contact: true }).microphone).toBe("receiving");
  });

  it("is receiving once a transcript or a snapshot arrives from the source", () => {
    expect(
      health([
        transcript(1, "hello", {
          sourceId: "microphone",
          speaker: "microphone",
        }),
        snapshot(2),
      ]),
    ).toMatchObject({
      microphone: "receiving",
      screen: "receiving",
      "application-audio": "waiting",
    });
  });

  it("maps each disconnect reason to its own state", () => {
    expect(
      health([
        disconnected(1, "microphone", "user-stopped"),
        disconnected(2, "application-audio", "permission-revoked"),
        disconnected(3, "screen", "device-lost"),
      ]),
    ).toEqual({
      microphone: "disconnected",
      "application-audio": "lost-permission",
      screen: "lost",
    });
    expect(health([disconnected(1, "screen", "error")]).screen).toBe("lost");
  });

  it("raises a gap, and a later transcript clears it", () => {
    const gapped = [gap(1, "application-audio", "source-interrupted", 5000)];
    expect(health(gapped)["application-audio"]).toBe("gap");
    expect(
      health([
        ...gapped,
        transcript(2, "back", { sourceId: "application-audio" }),
      ])["application-audio"],
    ).toBe("receiving");
  });

  it("uses the LAST event per source, so a reconnect clears a disconnect", () => {
    const events = [
      disconnected(1, "microphone", "device-lost"),
      transcript(2, "hello again", { sourceId: "microphone" }),
    ];
    expect(health(events).microphone).toBe("receiving");
    // ...and a disconnect after a transcript stands.
    expect(
      health([...events, disconnected(3, "microphone", "user-stopped")])
        .microphone,
    ).toBe("disconnected");
  });

  it("keeps a disconnect standing when the companion's own gap follows it", () => {
    // The companion records a lost source as a disconnect, then a zero-length
    // capture.gap (source-interrupted). The gap must not replace the reason: a
    // revoked permission stays "lost-permission", never a plain gap.
    const lostThenGap = (reason: "permission-revoked" | "device-lost") => [
      transcript(1, "before", { sourceId: "microphone" }),
      disconnected(2, "microphone", reason),
      gap(3, "microphone", "source-interrupted", 0),
    ];
    expect(health(lostThenGap("permission-revoked")).microphone).toBe(
      "lost-permission",
    );
    expect(health(lostThenGap("device-lost")).microphone).toBe("lost");
    // A later transcript still clears it.
    expect(
      health([
        ...lostThenGap("permission-revoked"),
        transcript(4, "back", { sourceId: "microphone" }),
      ]).microphone,
    ).toBe("receiving");
  });

  it("keeps one source's problem off the others", () => {
    expect(
      health([
        disconnected(1, "application-audio", "permission-revoked"),
        transcript(2, "mic line", { sourceId: "microphone" }),
      ]),
    ).toMatchObject({
      microphone: "receiving",
      "application-audio": "lost-permission",
    });
  });

  it("ignores a gap recorded because the session was paused", () => {
    expect(
      health([
        transcript(1, "x", { sourceId: "microphone" }),
        gap(2, "microphone", "paused"),
      ]).microphone,
    ).toBe("receiving");
  });

  it("carries the time, reason and duration of the problem", () => {
    const session = sessionView();
    const [, appAudio] = sourceStatuses(
      session,
      [gap(4, "application-audio", "buffer-overflow", 7000)],
      false,
    );
    expect(appAudio).toMatchObject({
      health: "gap",
      reason: "buffer-overflow",
      gapMs: 7000,
      lost: false,
      since: minutesAfter(0, 4),
    });
    const [mic] = sourceStatuses(
      session,
      [disconnected(5, "microphone", "device-lost")],
      false,
    );
    expect(mic).toMatchObject({ lost: true, reason: "device-lost" });
  });

  it("learns an opaque source id from its own disconnect, then reads later lines by it", () => {
    const events = [
      disconnected(1, "application-audio", "device-lost", "src-7f"),
      transcript(2, "resumed", { sourceId: "src-7f" }),
    ];
    expect(sourceIndex(events).sourceOf(events[1] as never)).toBe(
      "application-audio",
    );
    expect(health(events)["application-audio"]).toBe("receiving");
  });

  it("reads short aliases and leaves unknown ids unresolved", () => {
    const index = sourceIndex([]);
    expect(index.sourceOf(transcript(1, "x", { sourceId: "mic" }))).toBe(
      "microphone",
    );
    expect(
      index.sourceOf(transcript(1, "x", { sourceId: "app-audio-1" })),
    ).toBe("application-audio");
    expect(index.sourceOf(transcript(1, "x", { sourceId: "zzz" }))).toBeNull();
  });

  it("does not guess from malformed observation content", () => {
    const broken = {
      ...disconnected(1, "microphone", "device-lost"),
      content: stored(1, { source: 3 }),
    };
    expect(health([broken]).microphone).toBe("waiting");
  });
});

describe("companion and credential", () => {
  const now = Date.parse(minutesAfter(30));

  it("never claims contact the server has not recorded", () => {
    const model = companionModel(sessionView({ lastHeartbeatAt: null }), now);
    expect(model).toMatchObject({
      status: "never-seen",
      lastContactAt: null,
      ageMs: null,
    });
  });

  it("is online within the threshold and offline beyond it", () => {
    const at = (ageMs: number) =>
      companionModel(
        sessionView({ lastHeartbeatAt: new Date(now - ageMs).toISOString() }),
        now,
      );
    expect(at(10_000).status).toBe("online");
    expect(at(COMPANION_OFFLINE_AFTER_MS).status).toBe("online");
    expect(at(COMPANION_OFFLINE_AFTER_MS + 1).status).toBe("offline");
    expect(at(COMPANION_OFFLINE_AFTER_MS + 1).ageMs).toBe(
      COMPANION_OFFLINE_AFTER_MS + 1,
    );
  });

  it("states the offline threshold as the processor's own two minutes", () => {
    expect(COMPANION_OFFLINE_AFTER_MS).toBe(120_000);
  });

  it("classifies the credential: valid, expiring soon, expired, revoked", () => {
    const credential = (expiresInMs: number | null, revoked = false) =>
      companionModel(
        sessionView({
          credentialExpiresAt:
            expiresInMs === null
              ? null
              : new Date(now + expiresInMs).toISOString(),
          credentialRevoked: revoked,
        }),
        now,
      ).credential;
    expect(credential(60 * 60_000)).toBe("valid");
    expect(credential(CREDENTIAL_EXPIRING_SOON_MS)).toBe("expiring-soon");
    expect(credential(1)).toBe("expiring-soon");
    expect(credential(0)).toBe("expired");
    expect(credential(-5_000)).toBe("expired");
    expect(credential(60 * 60_000, true)).toBe("revoked");
    expect(credential(null)).toBe("none");
  });
});

describe("credential lifetime copy", () => {
  it("mirrors the contract's credentialLifetimeMs", () => {
    expect(CREDENTIAL_LIFETIME_MS).toBe(
      ACTIVE_SESSION_LIMITS.credentialLifetimeMs,
    );
  });
});
