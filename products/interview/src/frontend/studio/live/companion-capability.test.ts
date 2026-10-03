// The companion's last report turned into screen state: every state a report
// can be in, and that no state ever says the companion is connected.
import { describe, expect, it } from "vitest";
import {
  capabilityAdvisories,
  NO_REPORT_DETAIL,
  permissionLines,
  reportAge,
  speechState,
} from "./companion-capability";
import { capabilityReport, minutesAfter } from "./session-fixtures";

describe("speechState", () => {
  it("says honestly that no report exists, and blocks nothing", () => {
    const state = speechState(null);
    expect(state.key).toBe("no-report");
    expect(state.detail).toBe(NO_REPORT_DETAIL);
    expect(state.detail).toBe(
      "No capability report yet: the companion checks on its first session and fails visibly if device-only speech is unavailable.",
    );
    expect(state.blocksSpeech).toBe(false);
    expect(capabilityAdvisories(null)).toEqual([]);
  });

  it("is ready, and on this Mac, only when on-device recognition is available and authorised", () => {
    const state = speechState(capabilityReport());
    expect(state).toMatchObject({
      key: "ready",
      label: "On this Mac, in the companion",
      blocksSpeech: false,
    });
    expect(capabilityAdvisories(capabilityReport())).toEqual([]);
  });

  it("blocks when on-device recognition is unsupported for the locale, naming it", () => {
    const report = capabilityReport({ speech: { onDeviceAvailable: false } });
    expect(speechState(report)).toMatchObject({
      key: "on-device-unavailable",
      blocksSpeech: true,
    });
    const [blocker] = capabilityAdvisories(report);
    expect(blocker?.title).toBe("Not available on this Mac");
    expect(blocker?.body).toContain("en-GB");
    expect(blocker?.body).toContain(
      "Studio won’t fall back to a remote service by itself",
    );
  });

  it.each(["denied", "restricted"] as const)(
    "blocks when speech authorization is %s",
    (authorizationStatus) => {
      const report = capabilityReport({ speech: { authorizationStatus } });
      expect(speechState(report)).toMatchObject({
        key: "denied",
        blocksSpeech: true,
      });
      expect(capabilityAdvisories(report)).toHaveLength(1);
    },
  );

  it("treats an unavailable recognizer as unavailable speech", () => {
    const report = capabilityReport({ speech: { recognizerAvailable: false } });
    expect(speechState(report).key).toBe("recognizer-unavailable");
    expect(capabilityAdvisories(report)).toHaveLength(1);
  });

  it("does not block while permission is only not yet asked", () => {
    const report = capabilityReport({
      speech: { authorizationStatus: "not-determined" },
    });
    expect(speechState(report)).toMatchObject({
      key: "not-determined",
      blocksSpeech: false,
    });
    expect(capabilityAdvisories(report)).toEqual([]);
  });

  it("puts a denied permission before an unsupported language", () => {
    const report = capabilityReport({
      speech: { onDeviceAvailable: false, authorizationStatus: "denied" },
    });
    expect(speechState(report).key).toBe("denied");
  });

  it("never says the companion is connected or that remote processing fixes speech", () => {
    for (const report of [
      null,
      capabilityReport(),
      capabilityReport({ speech: { onDeviceAvailable: false } }),
      capabilityReport({ speech: { authorizationStatus: "denied" } }),
    ]) {
      const text = JSON.stringify([
        speechState(report),
        capabilityAdvisories(report),
      ]);
      expect(text).not.toMatch(/connected|allow remote|switch language/i);
    }
  });
});

describe("permissions and age", () => {
  it("lists the microphone and screen permission states", () => {
    expect(
      permissionLines(
        capabilityReport({
          permissions: { microphone: "denied", screen: "not-determined" },
        }),
      ).map((line) => [line.source, line.text, line.tone]),
    ).toEqual([
      ["microphone", "denied", "amber"],
      ["screen", "not asked yet", "neutral"],
    ]);
    expect(permissionLines(null)).toEqual([]);
  });

  it("dates a report from its own timestamp", () => {
    const report = capabilityReport({ reportedAt: minutesAfter(0) });
    expect(reportAge(report, Date.parse(minutesAfter(4)))).toBe(
      "reported 4 min ago",
    );
  });
});
