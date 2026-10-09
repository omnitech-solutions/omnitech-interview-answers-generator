import Foundation

// [DOMAIN] What "speaking" means on the wire, mirrored from
// packages/active-session-contracts/src/voice-activity.ts so the signal reads
// the same whichever sender produced it. A test parses that file and fails if
// a number here drifts, and both sides run the same scenarios.
// [STRATEGY] Energy with a hangover over an adaptive noise floor. Audio is
// measured in short hops; the floor is the QUIETEST hop of the last few
// seconds (speech always dips to the room's level between words, a steady
// noise never does, so a fan or music becomes the floor and stops reading as
// a voice); a voice starts after enough loud hops and stops only after a
// stretch of quiet ones, so a breath inside a sentence is not a stop.
// [SAFETY] Pure arithmetic over values handed in: nothing is kept but a few
// seconds of loudness values (never samples), and nothing is written or sent.
public enum VoiceActivityTuning {
    public static let hopMs = 20
    public static let startMs = 150
    public static let hangoverMs = 500
    public static let floorWindowMs = 3_000
    public static let marginDb = 10
    public static let hysteresisDb = 4
    public static let minThresholdDb = -48
    public static let maxFloorDb = -34
    public static let keepAliveMs = 1_000
    public static let idleKeepAliveMs = 15_000
    public static let retryMs = 1_000

    // Same names as the TypeScript object, for the drift test.
    public static let all: [String: Int] = [
        "hopMs": hopMs,
        "startMs": startMs,
        "hangoverMs": hangoverMs,
        "floorWindowMs": floorWindowMs,
        "marginDb": marginDb,
        "hysteresisDb": hysteresisDb,
        "minThresholdDb": minThresholdDb,
        "maxFloorDb": maxFloorDb,
        "keepAliveMs": keepAliveMs,
        "idleKeepAliveMs": idleKeepAliveMs,
        "retryMs": retryMs,
    ]
}

// One detector per audio source. [SAFETY] Sources never share one: the
// microphone's floor says nothing about the call's.
public struct VoiceActivityDetector: Sendable {
    // Digital silence, and the least a loudness value can be.
    private static let silenceDb = -120.0

    public private(set) var speaking = false
    private var aboveMs = 0
    private var belowMs = 0
    // The loudness of the last floorWindowMs of audio, oldest first.
    private var recent: [Double] = []
    // The hop being filled.
    private var rate = 0
    private var sumSquares = 0.0
    private var filled = 0

    public init() {}

    // Mono samples in [-1, 1] at any rate, in any frame length.
    @discardableResult
    public mutating func push(_ frame: AudioFrame) -> Bool {
        guard frame.sampleRate > 0 else { return speaking }
        // [GUARD] A change of rate starts the hop again: samples at two rates
        // are never measured as one.
        if frame.sampleRate != rate {
            rate = frame.sampleRate
            sumSquares = 0
            filled = 0
        }
        let perHop = max(1, Int((Double(rate * VoiceActivityTuning.hopMs) / 1000).rounded()))
        for sample in frame.samples {
            sumSquares += Double(sample) * Double(sample)
            filled += 1
            guard filled >= perHop else { continue }
            hop(10 * log10(max(sumSquares / Double(filled), 1e-12)))
            sumSquares = 0
            filled = 0
        }
        return speaking
    }

    @discardableResult
    public mutating func push(_ frames: [AudioFrame]) -> Bool {
        for frame in frames { push(frame) }
        return speaking
    }

    // Forgets everything: the source stopped, paused or changed.
    public mutating func reset() { self = VoiceActivityDetector() }

    private mutating func hop(_ level: Double) {
        let db = level.isFinite ? max(Self.silenceDb, min(0, level)) : Self.silenceDb
        // [STRATEGY] INVARIANT: the floor is read from the hops BEFORE this
        // one, so one hop can never set the bar it is judged against.
        let floor = recent.min() ?? Self.silenceDb
        let start = max(
            min(floor, Double(VoiceActivityTuning.maxFloorDb)) + Double(VoiceActivityTuning.marginDb),
            Double(VoiceActivityTuning.minThresholdDb))
        let ms = VoiceActivityTuning.hopMs
        if speaking {
            // A loud hop restarts the count: only unbroken quiet ends a voice.
            if db >= start - Double(VoiceActivityTuning.hysteresisDb) { belowMs = 0 } else { belowMs += ms }
            if belowMs >= VoiceActivityTuning.hangoverMs {
                speaking = false
                aboveMs = 0
            }
        } else {
            // A quiet hop takes back what a loud one added, so separate
            // clicks never add up to a voice.
            if db >= start { aboveMs += ms } else { aboveMs = max(0, aboveMs - ms) }
            if aboveMs >= VoiceActivityTuning.startMs {
                speaking = true
                belowMs = 0
            }
        }
        recent.append(db)
        let kept = VoiceActivityTuning.floorWindowMs / ms
        if recent.count > kept { recent.removeFirst(recent.count - kept) }
    }
}

// [DOMAIN] When a source's state is worth a message. The detector says what is
// true of the audio; this says when to say it, so the wire carries changes and
// a slow keep-alive instead of a message per frame. One per audio source.
public struct VoiceActivityReporter: Sendable {
    // What Studio was last told, or nil when it has been told nothing.
    public private(set) var told: Bool?
    private var toldAtMs = 0
    private var holdUntilMs = Int.min

    public init() {}

    // What to tell Studio now, if anything: a change at once, "speaking"
    // again every keepAliveMs, "not speaking" again every idleKeepAliveMs.
    public func next(speaking: Bool, nowMs: Int) -> Bool? {
        guard nowMs >= holdUntilMs else { return nil }
        guard let told, speaking == told else { return speaking }
        let every = speaking ? VoiceActivityTuning.keepAliveMs : VoiceActivityTuning.idleKeepAliveMs
        return nowMs - toldAtMs >= every ? speaking : nil
    }

    // Studio took the report.
    public mutating func sent(speaking: Bool, nowMs: Int) {
        told = speaking
        toldAtMs = nowMs
    }

    // The report did not get through: nothing more until retryMs has passed.
    public mutating func failed(nowMs: Int) { holdUntilMs = nowMs + VoiceActivityTuning.retryMs }

    public mutating func reset() { self = VoiceActivityReporter() }
}

// How much voice one source has carried: sizes only, for the event log.
public struct VoiceActivityTotals: Equatable, Sendable {
    public var voicedMs = 0
    public var starts = 0

    public init() {}
}
