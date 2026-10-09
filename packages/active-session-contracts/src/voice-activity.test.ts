// The detector on synthetic signals. Each signal is built from numbers here
// (a seeded noise, a voiced tone cut into syllables), so a run is the same
// every time and nothing is read from a file or a microphone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createVoiceActivityDetector,
  createVoiceActivityReporter,
  VOICE_ACTIVITY_TUNING,
} from "./voice-activity";

const RATE = 16_000;
const count = (ms: number, rate = RATE) => Math.round((rate * ms) / 1000);
const amplitude = (db: number) => 10 ** (db / 20);

// A small seeded generator: the same noise on every run.
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// White noise at an RMS level (uniform noise has RMS = peak / sqrt(3)).
function noise(ms: number, db: number, seed = 7, rate = RATE): number[] {
  const random = seeded(seed);
  const peak = amplitude(db) * Math.sqrt(3);
  return Array.from(
    { length: count(ms, rate) },
    () => (random() * 2 - 1) * peak,
  );
}

const silence = (ms: number, rate = RATE) => noise(ms, -90, 3, rate);

// A voice, near enough: a 140 Hz tone with harmonics at an RMS level, cut
// into syllables (180 ms voiced, 70 ms nearly silent), as speech is.
function speech(ms: number, db: number, rate = RATE): number[] {
  const peak = amplitude(db) * Math.SQRT2 * 0.8;
  return Array.from({ length: count(ms, rate) }, (_, at) => {
    const t = at / rate;
    const voiced = (t * 1000) % 250 < 180 ? 1 : 0.003;
    return (
      voiced *
      peak *
      (Math.sin(2 * Math.PI * 140 * t) +
        0.5 * Math.sin(2 * Math.PI * 280 * t) +
        0.25 * Math.sin(2 * Math.PI * 420 * t))
    );
  });
}

const mix = (a: number[], b: number[]) =>
  a.map((sample, at) => sample + (b[at] ?? 0));

// Runs a signal through a detector in frames and gives back when `speaking`
// changed, in milliseconds of audio.
function changes(
  signal: number[],
  options: { frame?: number; rate?: number } = {},
) {
  const rate = options.rate ?? RATE;
  const frame = options.frame ?? count(20, rate);
  const detector = createVoiceActivityDetector();
  const out: { at: number; speaking: boolean }[] = [];
  let was = false;
  for (let from = 0; from < signal.length; from += frame) {
    const now = detector.push(signal.slice(from, from + frame), rate);
    if (now !== was) {
      was = now;
      out.push({
        at: Math.round((Math.min(from + frame, signal.length) / rate) * 1000),
        speaking: now,
      });
    }
  }
  return out;
}

const { startMs, hangoverMs, floorWindowMs } = VOICE_ACTIVITY_TUNING;

describe("voice activity detector", () => {
  it("hears nothing in silence", () => {
    expect(changes(silence(10_000))).toEqual([]);
    expect(changes(new Array<number>(count(5_000)).fill(0))).toEqual([]);
  });

  it("does not read a steady noise as a voice", () => {
    // A fan, a hum, a call's comfort noise: loud, but never dipping.
    expect(changes(noise(20_000, -40))).toEqual([]);
    expect(changes(noise(20_000, -25))).toEqual([]);
  });

  it("lets a noise that starts in a quiet room go once it has become the floor", () => {
    const heard = changes([...silence(2_000), ...noise(20_000, -38)]);
    // It may read as a voice at first: nothing has said it is steady yet.
    // Within the floor's window and the hangover it stops, and stays stopped.
    expect(heard.length).toBeLessThanOrEqual(2);
    const stopped = heard.find((change) => !change.speaking);
    if (heard.length > 0) {
      expect(stopped).toBeDefined();
      expect((stopped?.at ?? 0) - 2_000).toBeLessThanOrEqual(
        floorWindowMs + hangoverMs + 200,
      );
    }
  });

  it("starts soon after a voice does and stops soon after it does", () => {
    const heard = changes([
      ...silence(1_000),
      ...speech(2_000, -26),
      ...silence(2_000),
    ]);
    expect(heard.map((change) => change.speaking)).toEqual([true, false]);
    const started = { at: heard[0]?.at ?? 0 };
    const stopped = { at: heard[1]?.at ?? 0 };
    // After startMs of voice, and no later than a syllable's gap past that.
    expect(started.at - 1_000).toBeGreaterThanOrEqual(startMs);
    expect(started.at - 1_000).toBeLessThanOrEqual(startMs + 150);
    // The last syllable ends 70 ms before the voice does.
    expect(stopped.at - 3_000).toBeGreaterThanOrEqual(hangoverMs - 100);
    expect(stopped.at - 3_000).toBeLessThanOrEqual(hangoverMs + 60);
  });

  it("does not read a short dip inside a sentence as a stop", () => {
    const heard = changes([
      ...silence(1_000),
      ...speech(1_500, -26),
      // A breath: shorter than the hangover.
      ...silence(300),
      ...speech(1_500, -26),
      ...silence(1_500),
    ]);
    expect(heard.map((change) => change.speaking)).toEqual([true, false]);
    expect((heard[1]?.at ?? 0) > 4_300).toBe(true);
  });

  it("reads a long pause as a stop, and the voice after it as a new start", () => {
    const heard = changes([
      ...silence(1_000),
      ...speech(1_500, -26),
      ...silence(1_200),
      ...speech(1_500, -26),
      ...silence(1_500),
    ]);
    expect(heard.map((change) => change.speaking)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    const stopped = heard[1]?.at ?? 0;
    const again = heard[2]?.at ?? 0;
    expect(stopped).toBeGreaterThan(2_500);
    expect(stopped).toBeLessThan(2_500 + hangoverMs + 100);
    expect(again).toBeGreaterThanOrEqual(3_700 + startMs);
    expect(again).toBeLessThanOrEqual(3_700 + startMs + 150);
  });

  it("stays on through twenty seconds of unbroken talk", () => {
    const heard = changes([
      ...silence(500),
      ...speech(20_000, -24),
      ...silence(1_500),
    ]);
    expect(heard.map((change) => change.speaking)).toEqual([true, false]);
    expect(heard[1]?.at ?? 0).toBeGreaterThan(20_500);
  });

  it("hears a voice over a steady noise, and its end", () => {
    const room = noise(7_000, -45);
    const voice = [
      ...new Array<number>(count(3_000)).fill(0),
      ...speech(2_000, -24),
      ...new Array<number>(count(2_000)).fill(0),
    ];
    const heard = changes(mix(room, voice));
    expect(heard.map((change) => change.speaking)).toEqual([true, false]);
    expect((heard[0]?.at ?? 0) - 3_000).toBeLessThanOrEqual(startMs + 150);
    expect((heard[1]?.at ?? 0) - 5_000).toBeLessThanOrEqual(hangoverMs + 100);
  });

  it("hears a quiet voice, and not a hiss below the least threshold", () => {
    expect(
      changes([
        ...silence(1_000),
        ...speech(2_000, -40),
        ...silence(1_000),
      ]).map((change) => change.speaking),
    ).toEqual([true, false]);
    expect(
      changes([...silence(1_000), ...speech(2_000, -60), ...silence(1_000)]),
    ).toEqual([]);
  });

  it("does not add separate clicks up into a voice", () => {
    // A key every 200 ms: 20 ms loud, 180 ms quiet.
    const typing = Array.from({ length: 50 }, () => [
      ...noise(20, -15, 11),
      ...silence(180),
    ]).flat();
    expect(changes(typing)).toEqual([]);
  });

  it("reads the same signal the same way whatever the frame length or rate", () => {
    const at16 = [...silence(1_000), ...speech(2_000, -26), ...silence(1_500)];
    const reference = changes(at16);
    expect(reference.map((change) => change.speaking)).toEqual([true, false]);
    // The microphone's 4096-sample buffers, the tap's 100 ms frames, one sample
    // short of a hop.
    for (const frame of [319, 1_600, 4_096]) {
      const heard = changes(at16, { frame });
      expect(heard.map((change) => change.speaking)).toEqual([true, false]);
      heard.forEach((change, index) => {
        // A change is seen when its frame ends, so it is late by up to a frame.
        const late = change.at - (reference[index]?.at ?? 0);
        expect(late).toBeGreaterThanOrEqual(0);
        expect(late).toBeLessThanOrEqual(Math.ceil((frame / RATE) * 1000) + 20);
      });
    }
    const at48 = [
      ...silence(1_000, 48_000),
      ...speech(2_000, -26, 48_000),
      ...silence(1_500, 48_000),
    ];
    const heard = changes(at48, { rate: 48_000, frame: 4_800 });
    expect(heard.map((change) => change.speaking)).toEqual([true, false]);
    expect(
      Math.abs((heard[0]?.at ?? 0) - (reference[0]?.at ?? 0)),
    ).toBeLessThan(130);
  });

  it("keeps each source's state to itself, and forgets on reset", () => {
    const microphone = createVoiceActivityDetector();
    const call = createVoiceActivityDetector();
    microphone.push([...silence(500), ...speech(1_000, -26)], RATE);
    call.push(silence(1_500), RATE);
    expect(microphone.speaking).toBe(true);
    expect(call.speaking).toBe(false);
    microphone.reset();
    expect(microphone.speaking).toBe(false);
    // Nothing of the old voice is left: quiet stays quiet.
    expect(microphone.push(silence(1_000), RATE)).toBe(false);
  });

  it("ignores a frame with no rate", () => {
    const detector = createVoiceActivityDetector();
    expect(detector.push(speech(1_000, -20), 0)).toBe(false);
  });
});

// The vectors both detectors answer to: the Swift companion's test reads the
// same file, so the two cannot drift apart in behaviour, only together.
describe("shared detector vectors", () => {
  const file = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "corpus",
        "vectors",
        "voice-activity.json",
      ),
      "utf8",
    ),
  ) as {
    sampleRate: number;
    vectors: {
      name: string;
      segments: { db: number; ms: number }[];
      changes: { atMs: number; speaking: boolean }[];
    }[];
  };

  it("has a spread of cases", () => {
    expect(file.vectors.length).toBeGreaterThanOrEqual(10);
    expect(file.vectors.some((vector) => vector.changes.length === 0)).toBe(
      true,
    );
    expect(file.vectors.some((vector) => vector.changes.length >= 4)).toBe(
      true,
    );
  });

  it.each(file.vectors.map((vector) => [vector.name, vector] as const))(
    "%s",
    (_name, vector) => {
      const detector = createVoiceActivityDetector();
      const frame = (file.sampleRate * 20) / 1000;
      const heard: { atMs: number; speaking: boolean }[] = [];
      let was = false;
      let atMs = 0;
      for (const segment of vector.segments) {
        const samples = new Array<number>(frame).fill(amplitude(segment.db));
        for (let ms = 0; ms < segment.ms; ms += 20) {
          const now = detector.push(samples, file.sampleRate);
          atMs += 20;
          if (now === was) continue;
          was = now;
          heard.push({ atMs, speaking: now });
        }
      }
      expect(heard).toEqual(vector.changes);
    },
  );
});

describe("voice activity reporter", () => {
  const { keepAliveMs, idleKeepAliveMs, retryMs } = VOICE_ACTIVITY_TUNING;

  it("says where it stands once, then only changes and keep-alives", () => {
    const reporter = createVoiceActivityReporter();
    // Nothing told yet: the first state is worth saying, speaking or not.
    expect(reporter.next(false, 0)).toBe(false);
    reporter.sent(false, 0);
    expect(reporter.told).toBe(false);
    expect(reporter.next(false, 500)).toBeUndefined();
    // A change is said at once.
    expect(reporter.next(true, 600)).toBe(true);
    reporter.sent(true, 600);
    // Still speaking: again only after the keep-alive.
    expect(reporter.next(true, 600 + keepAliveMs - 1)).toBeUndefined();
    expect(reporter.next(true, 600 + keepAliveMs)).toBe(true);
    reporter.sent(true, 600 + keepAliveMs);
    // Stopped: said at once, then again only rarely.
    expect(reporter.next(false, 2_000)).toBe(false);
    reporter.sent(false, 2_000);
    expect(reporter.next(false, 2_000 + idleKeepAliveMs - 1)).toBeUndefined();
    expect(reporter.next(false, 2_000 + idleKeepAliveMs)).toBe(false);
  });

  it("holds off after a report that did not get through, then says it again", () => {
    const reporter = createVoiceActivityReporter();
    expect(reporter.next(true, 0)).toBe(true);
    reporter.failed(0);
    expect(reporter.next(true, retryMs - 1)).toBeUndefined();
    // Not marked as told: the same state is still owed.
    expect(reporter.next(true, retryMs)).toBe(true);
    expect(reporter.told).toBeUndefined();
  });

  it("starts again after a reset", () => {
    const reporter = createVoiceActivityReporter();
    reporter.sent(true, 0);
    reporter.reset();
    expect(reporter.told).toBeUndefined();
    expect(reporter.next(false, 1)).toBe(false);
  });

  it("sends about a message a second while a voice goes on", () => {
    const reporter = createVoiceActivityReporter();
    let sent = 0;
    // A minute of speech, asked four times a second (the companion's pass).
    for (let now = 0; now < 60_000; now += 250) {
      const say = reporter.next(true, now);
      if (say === undefined) continue;
      reporter.sent(say, now);
      sent += 1;
    }
    expect(sent).toBe(60);
  });
});
