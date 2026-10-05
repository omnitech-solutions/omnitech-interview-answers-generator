// Hands-free Auto's decisions as pure units (ADR-0022): the perceptual hash, the
// rate limits, the restart backoff and the one status line.
import { describe, expect, it } from "vitest";
import {
  AUTO_MAX_PER_SESSION,
  AUTO_MIN_GAP_MS,
  type AutoGateInput,
  gateAutoCapture,
} from "./auto-gate";
import { dHash, hamming } from "./auto-hash";
import { type AutoLineInput, autoLine } from "./auto-line";
import {
  createRestartPolicy,
  HEALTHY_RUN_MS,
  RESTART_BASE_MS,
  RESTART_MAX_MS,
} from "./auto-restart";

// Bits (of 64) a blinking cursor may flip, and the least a different page flips.
const JITTER_BITS = 4;
const DIFFERENT_PAGE_BITS = 12;

const ramp = (descending = false) =>
  Array.from({ length: 72 }, (_, at) => {
    const column = at % 9;
    return (descending ? 9 - column : column) * 20;
  });

describe("dHash", () => {
  it("is the same for the same picture and tolerant of tiny noise", () => {
    const base = dHash(ramp());
    expect(hamming(base, dHash(ramp()))).toBe(0);
    const noisy = ramp();
    noisy[4] = (noisy[4] ?? 0) + 1;
    expect(hamming(base, dHash(noisy))).toBeLessThanOrEqual(JITTER_BITS);
  });
  it("differs in many bits for a different picture", () => {
    expect(hamming(dHash(ramp()), dHash(ramp(true)))).toBeGreaterThanOrEqual(
      DIFFERENT_PAGE_BITS,
    );
  });
});

describe("gate", () => {
  const ok: AutoGateInput = {
    nowMs: 100_000,
    open: true,
    paused: false,
    deviceOnly: false,
    sharing: true,
    inFlight: false,
    autoCount: 0,
    lastAutoAtMs: null,
  };
  const reason = (over: Partial<AutoGateInput>) => {
    const result = gateAutoCapture({ ...ok, ...over });
    return result.ok ? "ok" : result.reason;
  };
  it("allows a capture with nothing in the way", () => {
    expect(reason({})).toBe("ok");
  });
  it("refuses, with a reason, for each limit", () => {
    expect(reason({ open: false })).toBe("not-open");
    expect(reason({ paused: true })).toBe("paused");
    expect(reason({ deviceOnly: true })).toBe("device-only");
    expect(reason({ sharing: false })).toBe("no-source");
    expect(reason({ inFlight: true })).toBe("busy");
    expect(reason({ autoCount: AUTO_MAX_PER_SESSION })).toBe("cap");
    expect(reason({ autoCount: AUTO_MAX_PER_SESSION - 1 })).toBe("ok");
  });
  it("keeps at least 15 s between automatic analyses", () => {
    expect(reason({ lastAutoAtMs: ok.nowMs - AUTO_MIN_GAP_MS + 1 })).toBe(
      "too-soon",
    );
    expect(reason({ lastAutoAtMs: ok.nowMs - AUTO_MIN_GAP_MS })).toBe("ok");
  });
});

describe("restart policy", () => {
  it("restarts a healthy or productive run at once", () => {
    const policy = createRestartPolicy();
    policy.started(0);
    expect(policy.ended(HEALTHY_RUN_MS)).toBe(0);
    policy.started(0);
    policy.heard();
    expect(policy.ended(100)).toBe(0);
  });
  it("backs off, doubling to a cap, when runs die young, and recovers", () => {
    const policy = createRestartPolicy();
    const waits: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      policy.started(0);
      waits.push(policy.ended(10));
    }
    expect(waits.slice(0, 4)).toEqual([
      0,
      RESTART_BASE_MS,
      RESTART_BASE_MS * 2,
      RESTART_BASE_MS * 4,
    ]);
    expect(Math.max(...waits)).toBe(RESTART_MAX_MS);
    policy.started(0);
    policy.heard();
    expect(policy.ended(10)).toBe(0);
    policy.started(0);
    expect(policy.ended(10)).toBe(0);
  });
});

describe("the one status line", () => {
  const base: AutoLineInput = {
    open: true,
    paused: false,
    ownerPaused: false,
    resumeFailed: false,
    micDenied: false,
    micUnsupported: false,
    micError: null,
    listening: true,
    heardAgoMs: null,
    wantsScreen: true,
    deviceOnly: false,
    sharing: true,
    watchable: true,
    block: null,
  };
  const text = (over: Partial<AutoLineInput>) =>
    autoLine({ ...base, ...over })?.text;
  it("says what Auto is doing", () => {
    expect(text({})).toBe("Auto · listening · capturing every 8 s");
    expect(text({ heardAgoMs: 4_200 })).toBe(
      "Auto · listening · heard 4 s ago · capturing every 8 s",
    );
  });
  it("says the interval, the last analysis and the count", () => {
    expect(
      text({
        intervalSec: 8,
        lastAnalyzedAgoMs: 12_000,
        autoCount: 3,
        autoMax: 120,
      }),
    ).toBe(
      "Auto · listening · capturing every 8 s · last analyzed 12 s ago · 3 of 120 analyses",
    );
  });
  it("says Grant Screen Recording when the host cannot capture", () => {
    expect(text({ screenProblem: "permission-denied" })).toBe(
      "Auto · Grant Screen Recording to the app",
    );
  });
  it("needs no browser share when the host captures", () => {
    expect(text({ sharing: true })).not.toMatch(/Share/);
  });
  it("names the single action when something is lost", () => {
    expect(text({ sharing: false })).toMatch(/needs one click to share again/);
    expect(text({ micDenied: true })).toMatch(/Allow it in the browser/);
    expect(text({ paused: true, ownerPaused: true })).toMatch(/paused by you/);
    expect(text({ paused: true })).toMatch(/resuming/);
    expect(text({ paused: true, resumeFailed: true })).toMatch(/Press Resume/);
  });
  it("says device-only never watches the screen, and nothing once ended", () => {
    // The limits are said once, in the device-only card, not on this line.
    expect(text({ deviceOnly: true, sharing: false })).not.toMatch(
      /device-only|screen/,
    );
    expect(
      text({ deviceOnly: true, micError: "x", micUnsupported: true }),
    ).not.toMatch(/can’t listen|x/);
    expect(autoLine({ ...base, open: false })).toBeNull();
  });
});
