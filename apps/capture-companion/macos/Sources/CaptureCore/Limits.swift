// [DOMAIN] Mirrors ACTIVE_SESSION_LIMITS in
// packages/active-session-contracts/src/limits.ts. A test parses that file and
// fails if any number drifts, so the companion never sends what Studio would
// refuse by size or rate (rule:bounded-ingest).
public enum ActiveSessionLimits {
    public static let maxTranscriptTextChars = 4_000
    public static let maxScreenshotBytes = 2 * 1024 * 1024
    public static let maxEnvelopeBytes = 32 * 1024
    public static let maxObservationsPerSession = 20_000
    public static let maxScreenshotsPerSession = 400
    public static let maxIngestPerMinute = 120
    // Sessions do not expire by default (ten years), as limits.ts says.
    public static let sessionDurationCapMs = 10 * 365 * 24 * 60 * 60 * 1000
    public static let minHeartbeatIntervalMs = 1_000
    public static let maxVoiceActivityPerMinute = 240
    public static let credentialLifetimeMs = 2 * 60 * 60 * 1000
    public static let maxActiveSessionsPerOwner = 1
    public static let maxSpeakerLabelChars = 64
    public static let maxWindowLabelChars = 200

    // Same names as the TypeScript object, for the drift test.
    public static let all: [String: Int] = [
        "maxTranscriptTextChars": maxTranscriptTextChars,
        "maxScreenshotBytes": maxScreenshotBytes,
        "maxEnvelopeBytes": maxEnvelopeBytes,
        "maxObservationsPerSession": maxObservationsPerSession,
        "maxScreenshotsPerSession": maxScreenshotsPerSession,
        "maxIngestPerMinute": maxIngestPerMinute,
        "sessionDurationCapMs": sessionDurationCapMs,
        "minHeartbeatIntervalMs": minHeartbeatIntervalMs,
        "maxVoiceActivityPerMinute": maxVoiceActivityPerMinute,
        "credentialLifetimeMs": credentialLifetimeMs,
        "maxActiveSessionsPerOwner": maxActiveSessionsPerOwner,
        "maxSpeakerLabelChars": maxSpeakerLabelChars,
        "maxWindowLabelChars": maxWindowLabelChars,
    ]
}
