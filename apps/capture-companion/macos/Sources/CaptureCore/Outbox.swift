import Foundation

// [DOMAIN] Observations get their identity once, at creation: a monotonic
// sequence per source and a stable event id. The outbox keeps the exact
// observation until Studio acknowledges it, so a resend after a dropped
// connection carries the SAME ids and Studio deduplicates by (sourceId,
// eventId) (rule:idempotent-observation).
public final class ObservationFactory {
    public let runId: String
    private let clock: WallClock
    private var sequences: [String: Int] = [:]

    public init(runId: String, clock: WallClock) {
        self.runId = runId
        self.clock = clock
    }

    public func sourceId(for source: CaptureSource) -> String { "\(source.rawValue)-\(runId)" }
    public var companionId: String { "companion-\(runId)" }

    public func make(_ source: CaptureSource, _ body: ObservationBody) -> Observation {
        let sourceId = sourceId(for: source)
        let sequence = sequences[sourceId, default: 0]
        sequences[sourceId] = sequence + 1
        return Observation(
            envelope: Envelope(
                sourceId: sourceId, eventId: "\(runId)-\(source.rawValue)-\(sequence)",
                occurredAt: TimeText.iso(clock.now()), sequence: sequence),
            body: body)
    }
}

public struct QueuedObservation: Sendable {
    public let observation: Observation
    public let payload: Data?
    public fileprivate(set) var notBefore: Date
}

public enum EnqueueResult: Equatable, Sendable {
    case queued
    // The bounded queue was full; a capture.gap will record what was lost.
    case overflowed
}

public enum AckOutcome: Equatable, Sendable {
    case delivered
    case retryLater(afterSeconds: Double?)
    // The refusal cannot succeed on resend: the message is dropped and surfaced.
    case droppedPermanent(RefusalCode)
}

// Bounded, in-memory, single-threaded (confined to the companion's session
// queue). Nothing here is written to disk.
public final class Outbox {
    public let capacity: Int
    public let maxPayloadBytes: Int
    private let factory: ObservationFactory
    private var queue: [QueuedObservation] = []
    private var payloadBytes = 0
    // Content dropped for lack of room, per source, waiting to become a capture.gap.
    private var overflow: [CaptureSource: (durationMs: Int, count: Int)] = [:]
    private static let controlHeadroom = 16

    public init(capacity: Int = 500, maxPayloadBytes: Int = 16 * 1024 * 1024, factory: ObservationFactory) {
        self.capacity = capacity
        self.maxPayloadBytes = maxPayloadBytes
        self.factory = factory
    }

    public var count: Int { queue.count }
    public var isEmpty: Bool { queue.isEmpty }
    public var pendingOverflowSources: [CaptureSource] { overflow.keys.sorted { $0.rawValue < $1.rawValue } }
    public var queuedObservations: [Observation] { queue.map(\.observation) }

    // [GUARD] Content (transcripts, screenshots) is bounded by `capacity` and
    // payload bytes; gaps and disconnects get a small fixed headroom because
    // they are how loss is reported.
    @discardableResult
    public func enqueue(_ observation: Observation, payload: Data? = nil, now: Date = Date()) -> EnqueueResult {
        let extra = payload?.count ?? 0
        let limit = observation.isContent ? capacity : capacity + Self.controlHeadroom
        if queue.count >= limit || payloadBytes + extra > maxPayloadBytes {
            if observation.isContent { recordOverflow(observation) }
            return .overflowed
        }
        queue.append(QueuedObservation(observation: observation, payload: payload, notBefore: now))
        payloadBytes += extra
        return .queued
    }

    private func recordOverflow(_ observation: Observation) {
        var duration = 0
        if case .transcriptFinal(let content) = observation.body { duration = max(0, content.endMs - content.startMs) }
        let source = observation.captureSource
        let current = overflow[source, default: (0, 0)]
        overflow[source] = (current.durationMs + duration, current.count + 1)
    }

    // The next observation due for sending, oldest first. Order is preserved:
    // a backed-off head holds the queue so Studio sees sequences in order.
    public func next(now: Date) -> QueuedObservation? {
        materializeOverflowGaps(now: now)
        guard let head = queue.first, head.notBefore <= now else { return nil }
        return head
    }

    // [STRATEGY] When room returns, record each overflow as one capture.gap
    // with the lost duration, so Studio can say what is missing.
    private func materializeOverflowGaps(now: Date) {
        guard !overflow.isEmpty else { return }
        for source in pendingOverflowSources where queue.count < capacity + Self.controlHeadroom {
            guard let lost = overflow.removeValue(forKey: source) else { continue }
            let gap = factory.make(
                source, .captureGap(source: source, durationMs: lost.durationMs, reason: .bufferOverflow))
            enqueue(gap, now: now)
        }
    }

    public func deferHead(until time: Date) {
        guard !queue.isEmpty else { return }
        queue[0].notBefore = time
    }

    // [DOMAIN] Applies an acknowledgement for `observation`: accepted and
    // duplicate both mean Studio has it; rate_limited and session_paused keep
    // the message; every other refusal is permanent and drops it.
    @discardableResult
    public func handle(_ ack: Acknowledgement, for observation: Observation, retryAfterSeconds: Double? = nil)
        -> AckOutcome
    {
        let key = observation.envelope
        switch ack {
        case .accepted(let accepted), .duplicate(let accepted):
            guard accepted.sourceId == key.sourceId, accepted.eventId == key.eventId else {
                return .retryLater(afterSeconds: retryAfterSeconds)
            }
            remove(key)
            return .delivered
        case .refused(let code, _, _):
            switch code {
            case .rateLimited, .sessionPaused:
                return .retryLater(afterSeconds: retryAfterSeconds)
            default:
                remove(key)
                return .droppedPermanent(code)
            }
        }
    }

    private func remove(_ key: Envelope) {
        guard let index = queue.firstIndex(where: { $0.observation.envelope == key }) else { return }
        payloadBytes -= queue[index].payload?.count ?? 0
        queue.remove(at: index)
    }

    // Pause: captured content is stale and never sent late; losses stay.
    public func discardContent() {
        queue.removeAll { $0.observation.isContent }
        payloadBytes = queue.reduce(0) { $0 + ($1.payload?.count ?? 0) }
        overflow.removeAll()
    }

    // End, purge, refused credential: nothing more may be sent.
    public func clear() {
        queue.removeAll()
        payloadBytes = 0
        overflow.removeAll()
    }
}
