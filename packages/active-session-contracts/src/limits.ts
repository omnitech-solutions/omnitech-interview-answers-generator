// Frozen ingest limits (rule:bounded-ingest). Sized for the recruiter-screen
// profile: a question every 1-3 minutes, a 30-90 second answer window, and a
// session of a few hours. Every limit is checked at ingest and refused with a
// stable code, never truncated.
export const ACTIVE_SESSION_LIMITS = Object.freeze({
  // A final transcript segment is one utterance; 4,000 characters covers a long
  // monologue segment (about 60 seconds of speech is ~1,000) with headroom.
  maxTranscriptTextChars: 4_000,
  // A compressed full-window screenshot; larger frames are the companion's to
  // downscale, not Studio's to store.
  maxScreenshotBytes: 2 * 1024 * 1024,
  // One serialized envelope: 4,000 characters at up to 4 UTF-8 bytes each plus
  // field overhead stays under 32 KiB. Screenshots travel as separate payloads.
  maxEnvelopeBytes: 32 * 1024,
  // Segments, gaps and disconnects over a four-hour session at a few per minute.
  maxObservationsPerSession: 20_000,
  // About one snapshot per 30 seconds for the whole session cap, rounded down;
  // 400 x 2 MiB bounds screenshot storage per session.
  maxScreenshotsPerSession: 400,
  // Bursts of finalised segments after a pause, not a sustained stream.
  maxIngestPerMinute: 120,
  // A session of a few hours; capture ends visibly at the cap.
  // No expiry by default (owner's rule, 2026-10-07): a session lives until it is
  // ended. Ten years is the cap only because a timestamp needs a value.
  sessionDurationCapMs: 10 * 365 * 24 * 60 * 60 * 1000,
  // Heartbeats and capability reports are rate-bounded by minimum spacing: the
  // companion heartbeats about every 5 s, so 1 s leaves headroom for a resume
  // heartbeat while stopping a loop from hammering the contact stamp. Closer
  // messages are refused rate_limited, never queued.
  minHeartbeatIntervalMs: 1_000,
  // Short-lived and strictly under the duration cap; a longer session needs an
  // owner-initiated replacement (rule:credential-lifetime-and-renewal).
  credentialLifetimeMs: 2 * 60 * 60 * 1000,
  // Private to the actor and bounded in resource use.
  maxActiveSessionsPerOwner: 1,
  // Label fields carry short names, never content.
  maxSpeakerLabelChars: 64,
  maxWindowLabelChars: 200,
});

export type ActiveSessionLimits = typeof ACTIVE_SESSION_LIMITS;
