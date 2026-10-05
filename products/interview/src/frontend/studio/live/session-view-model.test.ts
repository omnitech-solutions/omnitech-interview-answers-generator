// The pure parts of the live view: the withheld record on a run, the ages and
// clock labels, the banner copy and the capability table. Each sentence here is
// shown to the owner, so each one is checked against what the product does.
import { describe, expect, it } from "vitest";
import { bannerCopy } from "./banner-copy";
import { capabilityRows } from "./capability-table";
import { speechState } from "./companion-capability";
import { ageLabel, clockLabel, plural } from "./session-format";
import { parseWithheldResult } from "./session-results";
import { deriveLiveModel } from "./session-state";
import {
  action,
  disconnected,
  gap,
  minutesAfter,
  READY_REPORT,
  sessionView,
} from "./testing/session-fixtures";

const model = (
  overrides: Parameters<typeof sessionView>[0] = {},
  observations: Parameters<typeof deriveLiveModel>[0]["observations"] = [],
  nowMinutes = 10,
) =>
  deriveLiveModel({
    session: sessionView(overrides),
    observations,
    actions: [],
    serverClockOffsetMs: 0,
    nowMs: Date.parse(minutesAfter(nowMinutes)),
  });

describe("withheld result", () => {
  it("reads the content-free count and ignores anything else", () => {
    expect(
      parseWithheldResult({
        withheld: { rejectedClaimCount: 2, codes: ["a"] },
      }),
    ).toEqual({ rejectedClaimCount: 2 });
    expect(parseWithheldResult({ withheld: { rejectedClaimCount: -1 } })).toBe(
      null,
    );
    expect(parseWithheldResult(null)).toBe(null);
    expect(parseWithheldResult({ draft: "x" })).toBe(null);
  });

  it("puts the count on the run of a withheld action and tolerates its absence", () => {
    const run = (result: unknown) =>
      deriveLiveModel({
        session: sessionView(),
        observations: [],
        actions: [
          action({
            dispatchStatus: "suppressed",
            suppressionReason: "invalid_output",
            result,
          }),
        ],
        serverClockOffsetMs: 0,
        nowMs: Date.parse(minutesAfter(2)),
      }).runs[0];
    expect(
      run({ withheld: { rejectedClaimCount: 3, codes: [] } })
        ?.rejectedClaimCount,
    ).toBe(3);
    expect(run(null)?.rejectedClaimCount).toBe(null);
  });
});

describe("labels", () => {
  it("ages move by the minute, never by the second", () => {
    expect(ageLabel(4_000)).toBe("less than a minute");
    expect(ageLabel(59_999)).toBe("less than a minute");
    expect(ageLabel(60_000)).toBe("1 min");
    expect(ageLabel(150_000)).toBe("2 min");
    expect(ageLabel(65 * 60_000)).toBe("1 h 5 min");
    expect(ageLabel(120 * 60_000)).toBe("2 h");
  });
  it("labels a line by how far into the session it arrived", () => {
    expect(clockLabel(minutesAfter(3, 7), minutesAfter(0))).toBe("3:07");
    expect(clockLabel(minutesAfter(0), minutesAfter(5))).toBe("0:00");
    expect(clockLabel("nonsense", minutesAfter(5))).toBe("");
  });
  it("pluralises", () => {
    expect(plural(1, "claim")).toBe("1 claim");
    expect(plural(2, "claim")).toBe("2 claims");
  });
});

describe("banner copy", () => {
  it("says what Studio observed, not what the companion will do", () => {
    const m = model(
      {
        lastHeartbeatAt: minutesAfter(9, 30),
        captureSources: ["microphone", "screen"],
      },
      [disconnected(1, "screen", "permission-revoked")],
      10,
    );
    const banner = m.banners.find((b) => b.kind === "permission-revoked");
    const copy = bannerCopy(banner!, m, "native");
    expect(copy.title).toMatch(/permission for Screen was revoked/i);
    expect(copy.detail).toMatch(/System Settings/);
    expect(copy.detail).not.toMatch(/will resume/i);
    expect(copy.action).toBe("sources");
  });

  it("states the recorded gap only for a gap that was recorded", () => {
    const m = model({ lastHeartbeatAt: minutesAfter(9, 50) }, [
      gap(1, "application-audio", "buffer-overflow", 4000),
    ]);
    const copy = bannerCopy(
      m.banners.find((b) => b.kind === "gap")!,
      m,
      "native",
    );
    expect(copy.detail).toMatch(/recorded in the transcript/);
    const lost = model({ lastHeartbeatAt: minutesAfter(9, 50) }, [
      disconnected(1, "application-audio", "device-lost"),
    ]);
    const lostCopy = bannerCopy(
      lost.banners.find((b) => b.kind === "source-lost")!,
      lost,
      "native",
    );
    expect(lostCopy.title).toMatch(/App audio was lost/);
    expect(lostCopy.detail).toMatch(/other side of the call/);
  });

  it("has no banner for the optional companion, whether never seen or gone quiet", () => {
    expect(model().banners.map((b) => b.kind)).not.toContain(
      "companion-offline",
    );
    expect(
      model({ lastHeartbeatAt: minutesAfter(3) }, [], 10).banners.map(
        (b) => b.kind,
      ),
    ).toEqual([]);
  });

  it("offers renewal for a credential problem and nothing for the cap", () => {
    const expired = model({
      lastHeartbeatAt: minutesAfter(9, 55),
      credentialExpiresAt: minutesAfter(5),
    });
    expect(
      bannerCopy(
        expired.banners.find((b) => b.kind === "credential-expired")!,
        expired,
        "native",
      ).action,
    ).toBe("renew");
    const cap = model(
      { lastHeartbeatAt: minutesAfter(9, 55), expiresAt: minutesAfter(15) },
      [],
      10,
    );
    const copy = bannerCopy(
      cap.banners.find((b) => b.kind === "cap-near")!,
      cap,
      "native",
    );
    expect(copy.title).toMatch(/5 min/);
    expect(copy.action).toBe(null);
  });

  it("describes a pause without claiming capture stopped", () => {
    const m = model({ status: "paused", lastHeartbeatAt: minutesAfter(9, 55) });
    const copy = bannerCopy(m.banners[0]!, m, "native");
    expect(copy.title).toMatch(/^Paused/);
    expect(copy.detail).toMatch(/No new work will start/);
    expect(copy.detail).not.toMatch(/nothing is being captured/i);
    expect(copy.action).toBe("resume");
  });
});

describe("banner buttons", () => {
  const appAudio = (kind: "gap" | "source-lost") => {
    const m = model(
      { lastHeartbeatAt: minutesAfter(9, 50) },
      kind === "gap"
        ? [gap(1, "application-audio", "buffer-overflow", 4000)]
        : [disconnected(1, "application-audio", "device-lost")],
    );
    return { m, banner: m.banners.find((b) => b.kind === kind)! };
  };

  it("offers pairing for lost app audio in a browser, and never a fake reconnect", () => {
    for (const kind of ["gap", "source-lost"] as const) {
      const { m, banner } = appAudio(kind);
      const copy = bannerCopy(banner, m, "browser");
      expect(copy.action).toBe("pair");
      expect(copy.actionLabel).toBe("Pair companion");
    }
  });

  it("sends the Mac app to Sources, since no bridge action can reconnect a source", () => {
    for (const kind of ["gap", "source-lost"] as const) {
      const { m, banner } = appAudio(kind);
      const copy = bannerCopy(banner, m, "native");
      expect(copy.action).toBe("sources");
      expect(copy.actionLabel).toBe("Open Sources");
    }
  });

  it("sends a lost microphone to Sources in either host", () => {
    const m = model({ lastHeartbeatAt: minutesAfter(9, 50) }, [
      disconnected(1, "microphone", "device-lost"),
    ]);
    const banner = m.banners.find((b) => b.kind === "source-lost")!;
    expect(bannerCopy(banner, m, "browser").action).toBe("sources");
  });
});

describe("capability table", () => {
  it("says nothing about speech until a report was read", () => {
    const where = Object.fromEntries(
      capabilityRows("device-only").map((r) => [r.label, r.where]),
    );
    expect(where["Speech"]).toBe("Not known: no capability report read");
  });
  it("shows an on-device answer and refuses code when the session is device-only", () => {
    const where = Object.fromEntries(
      capabilityRows("device-only", speechState(READY_REPORT)).map((r) => [
        r.label,
        r.where,
      ]),
    );
    expect(where["Speech"]).toBe("On this Mac, in the companion");
    expect(where["Answer drafts"]).toBe("On this Mac");
    expect(where["Coding drafts and tests"]).toBe(
      "Refused: needs a remote model",
    );
    // Device-only never sends a screenshot to a model.
    expect(where["Screen reading"]).toBeUndefined();
    expect(where["Screenshots"]).toBe(
      "Stored for you; never sent to a model: Analyze is refused in device-only mode",
    );
    expect(where["Raw audio"]).toBe("Memory only, never saved");
  });
  it("names the gateway when remote processing is allowed", () => {
    const where = Object.fromEntries(
      capabilityRows("permitted-remote", speechState(READY_REPORT)).map((r) => [
        r.label,
        r.where,
      ]),
    );
    expect(where["Answer drafts"]).toBe(
      "Remote model, through Studio's AI gateway",
    );
    expect(where["Coding drafts and tests"]).toBe(
      "Remote model, through Studio's AI gateway",
    );
    expect(where["Speech"]).toBe("On this Mac, in the companion");
    // Remote: a capture goes to the vision model, and only on Analyze.
    expect(where["Screenshots"]).toBe(
      "Stored for you; sent to the selected vision-capable model only when you press Analyze",
    );
  });
});
