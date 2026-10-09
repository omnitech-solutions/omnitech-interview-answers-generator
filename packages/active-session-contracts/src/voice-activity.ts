// [DOMAIN] What "speaking" means on the wire: the one definition every sender
// of a voice.activity message shares, so the signal reads the same whichever
// source produced it. It lives with the contract for that reason, and because
// its two senders (the capture companion, which may import only this package,
// and the Studio's own window) have nothing else in common. The macOS
// companion mirrors it in Swift (CaptureCore/VoiceActivity.swift); a test
// there parses the numbers below and fails if one drifts.
//
// [STRATEGY] Energy with a hangover over an adaptive noise floor. Audio is
// measured in short hops; the floor is the QUIETEST hop of the last few
// seconds (speech always dips to the room's level between words, a steady
// noise never does, so a fan or music becomes the floor and stops reading as
// a voice); a voice starts after enough loud hops and stops only after a
// stretch of quiet ones, so a breath inside a sentence is not a stop.
// [SAFETY] Pure arithmetic over numbers handed in: nothing is kept but a few
// seconds of loudness values (never samples), and nothing is written or sent.

export const VOICE_ACTIVITY_TUNING = Object.freeze({
  // The length of audio one loudness value is measured over.
  hopMs: 20,
  // A voice has started after this much audio above the start threshold.
  startMs: 150,
  // A voice has stopped after this much audio below the stop threshold.
  hangoverMs: 500,
  // The noise floor is the quietest hop of this much recent audio.
  floorWindowMs: 3_000,
  // The start threshold sits this far above the floor (dB).
  marginDb: 10,
  // The stop threshold sits this far below the start threshold (dB).
  hysteresisDb: 4,
  // Never start below this (dBFS): a silent line's hiss is not a voice.
  minThresholdDb: -48,
  // The floor never rises above this (dBFS), so a voice in a loud room can
  // still be told from it.
  maxFloorDb: -34,
  // While a voice goes on, say so again this often (Studio lets a "speaking"
  // that is not repeated lapse).
  keepAliveMs: 1_000,
  // While nobody speaks, say so again this often: a Studio that restarted or
  // cleared its transcript learns the signal exists without waiting for the
  // next voice.
  idleKeepAliveMs: 15_000,
  // After a report that did not get through, wait this long before another.
  retryMs: 1_000,
});
export type VoiceActivityTuning = {
  readonly [K in keyof typeof VOICE_ACTIVITY_TUNING]: number;
};

// Digital silence, and the least a loudness value can be.
const SILENCE_DB = -120;

export type VoiceActivityDetector = {
  readonly speaking: boolean;
  // Mono PCM in [-1, 1] at any rate, in any frame length. Returns `speaking`.
  push(samples: ArrayLike<number>, sampleRate: number): boolean;
  // Forgets everything: the source stopped, paused or changed.
  reset(): void;
};

// One detector per audio source. [SAFETY] Sources never share one: the
// microphone's floor says nothing about the call's.
export function createVoiceActivityDetector(
  tuning: VoiceActivityTuning = VOICE_ACTIVITY_TUNING,
): VoiceActivityDetector {
  let speaking = false;
  let aboveMs = 0;
  let belowMs = 0;
  // The loudness of the last floorWindowMs of audio, oldest first.
  let recent: { db: number; ms: number }[] = [];
  let recentMs = 0;
  // The hop being filled from PCM.
  let rate = 0;
  let sumSquares = 0;
  let filled = 0;

  const hop = (levelDb: number, ms: number) => {
    if (!(ms > 0)) return;
    const db = Number.isFinite(levelDb)
      ? Math.max(SILENCE_DB, Math.min(0, levelDb))
      : SILENCE_DB;
    // [STRATEGY] INVARIANT: the floor is read from the hops BEFORE this one,
    // so one hop can never set the bar it is judged against.
    let floor = SILENCE_DB;
    if (recent.length > 0) {
      floor = 0;
      for (const past of recent) if (past.db < floor) floor = past.db;
    }
    const start = Math.max(
      Math.min(floor, tuning.maxFloorDb) + tuning.marginDb,
      tuning.minThresholdDb,
    );
    if (speaking) {
      // A loud hop restarts the count: only unbroken quiet ends a voice.
      if (db >= start - tuning.hysteresisDb) belowMs = 0;
      else belowMs += ms;
      if (belowMs >= tuning.hangoverMs) {
        speaking = false;
        aboveMs = 0;
      }
    } else {
      // A quiet hop takes back what a loud one added, so separate clicks
      // never add up to a voice.
      if (db >= start) aboveMs += ms;
      else aboveMs = Math.max(0, aboveMs - ms);
      if (aboveMs >= tuning.startMs) {
        speaking = true;
        belowMs = 0;
      }
    }
    recent.push({ db, ms });
    recentMs += ms;
    while (recentMs > tuning.floorWindowMs && recent.length > 1) {
      recentMs -= (recent.shift() as { ms: number }).ms;
    }
  };

  return {
    get speaking() {
      return speaking;
    },
    push(samples, sampleRate) {
      if (!(sampleRate > 0)) return speaking;
      // [GUARD] A change of rate starts the hop again: samples at two rates
      // are never measured as one.
      if (sampleRate !== rate) {
        rate = sampleRate;
        sumSquares = 0;
        filled = 0;
      }
      const perHop = Math.max(1, Math.round((rate * tuning.hopMs) / 1000));
      for (let at = 0; at < samples.length; at += 1) {
        const sample = samples[at] as number;
        sumSquares += sample * sample;
        filled += 1;
        if (filled < perHop) continue;
        hop(
          10 * Math.log10(Math.max(sumSquares / filled, 1e-12)),
          tuning.hopMs,
        );
        sumSquares = 0;
        filled = 0;
      }
      return speaking;
    },
    reset() {
      speaking = false;
      aboveMs = 0;
      belowMs = 0;
      recent = [];
      recentMs = 0;
      sumSquares = 0;
      filled = 0;
    },
  };
}

export type VoiceActivityReporter = {
  // What to tell Studio now, if anything: a change at once, "speaking" again
  // every keepAliveMs, "not speaking" again every idleKeepAliveMs.
  next(speaking: boolean, nowMs: number): boolean | undefined;
  // Studio took the report.
  sent(speaking: boolean, nowMs: number): void;
  // The report did not get through: nothing more until retryMs has passed.
  failed(nowMs: number): void;
  // What Studio was last told, or undefined when it has been told nothing.
  readonly told: boolean | undefined;
  reset(): void;
};

// [DOMAIN] When a source's state is worth a message. The detector says what is
// true of the audio; this says when to say it, so the wire carries changes and
// a slow keep-alive instead of a message per frame. One per audio source.
export function createVoiceActivityReporter(
  tuning: VoiceActivityTuning = VOICE_ACTIVITY_TUNING,
): VoiceActivityReporter {
  let told: boolean | undefined;
  let toldAt = 0;
  let holdUntil = Number.NEGATIVE_INFINITY;
  return {
    get told() {
      return told;
    },
    next(speaking, nowMs) {
      if (nowMs < holdUntil) return undefined;
      if (told === undefined || speaking !== told) return speaking;
      const every = speaking ? tuning.keepAliveMs : tuning.idleKeepAliveMs;
      return nowMs - toldAt >= every ? speaking : undefined;
    },
    sent(speaking, nowMs) {
      told = speaking;
      toldAt = nowMs;
    },
    failed(nowMs) {
      holdUntil = nowMs + tuning.retryMs;
    },
    reset() {
      told = undefined;
      toldAt = 0;
      holdUntil = Number.NEGATIVE_INFINITY;
    },
  };
}
