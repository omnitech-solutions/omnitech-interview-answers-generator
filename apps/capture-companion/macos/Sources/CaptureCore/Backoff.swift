// [STRATEGY] Exponential backoff with jitter, and Retry-After honoured. The
// random source is injected so tests are deterministic and the policy has no
// hidden dependency (rule:bounded-ingest: a rate-limited sender slows down, it
// never hammers).
public struct Backoff {
    public let baseSeconds: Double
    public let capSeconds: Double
    // A server-supplied Retry-After above this is clamped; a hostile or buggy
    // value must not park the companion for hours.
    public let retryAfterCeilingSeconds: Double
    private let random: () -> Double
    public private(set) var failures = 0

    // `random` returns a value in 0..<1.
    public init(
        baseSeconds: Double = 1, capSeconds: Double = 60, retryAfterCeilingSeconds: Double = 600,
        random: @escaping () -> Double
    ) {
        self.baseSeconds = baseSeconds
        self.capSeconds = capSeconds
        self.retryAfterCeilingSeconds = retryAfterCeilingSeconds
        self.random = random
    }

    // [STRATEGY] Delay before the next attempt: half to full of the exponential
    // step (so concurrent companions spread out), never below Retry-After.
    public mutating func nextDelay(retryAfterSeconds: Double? = nil) -> Double {
        let step = min(capSeconds, baseSeconds * Double(1 << min(failures, 20)))
        failures += 1
        let jittered = step * (0.5 + 0.5 * min(max(random(), 0), 0.999_999))
        guard let retryAfterSeconds, retryAfterSeconds > 0 else { return jittered }
        return max(jittered, min(retryAfterSeconds, retryAfterCeilingSeconds))
    }

    // [INVARIANT] A delivered message ends the failure streak.
    public mutating func reset() { failures = 0 }
}
