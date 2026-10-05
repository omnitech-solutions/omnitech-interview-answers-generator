import Foundation

// [DOMAIN] Repeated page captures (Auto asks every few seconds). Two rules keep
// that cheap and quiet: one capture in flight at a time (a request that arrives
// during another is refused as a visible loss, never queued), and Screen
// Recording is asked for at most once per launch (later denials answer
// "permission-denied" without re-prompting).
@MainActor
public final class CaptureGate {
    public private(set) var inFlight = false
    public private(set) var refused = 0
    private var prompted = false

    public init() {}

    // Runs `body` unless another capture is in flight (nil: busy).
    public func run<T>(_ body: () async -> T) async -> T? {
        guard !inFlight else {
            refused += 1
            return nil
        }
        inFlight = true
        defer { inFlight = false }
        return await body()
    }

    // True exactly once while access is missing: the one place macOS may prompt.
    public func shouldPromptForAccess(granted: Bool) -> Bool {
        if granted { return false }
        if prompted { return false }
        prompted = true
        return true
    }
}

// [DOMAIN] The owner's display previews (listDisplays with thumbnails) are rendered
// from EVERY display, non-browser apps included, so they are rationed: one run in
// flight, and no new run until `minimumInterval` after the last one finished. A
// request inside that window is answered with the previous result (kept in memory
// for at most that window) or, when there is none, as busy. [SAFETY] This bounds how
// often the page can read other apps' pixels; it is not the browser gate (previews
// are the owner's own picker, see plan 7.0s T34).
@MainActor
public final class PreviewThrottle<Value> {
    public enum Begin {
        case run
        case reuse(Value)
        case busy
    }

    public static var defaultInterval: TimeInterval { 2.5 }
    private let minimumInterval: TimeInterval
    private let now: () -> TimeInterval
    private var inFlight = false
    private var last: (at: TimeInterval, value: Value)?

    public init(minimumInterval: TimeInterval = PreviewThrottle.defaultInterval, now: @escaping () -> TimeInterval) {
        self.minimumInterval = minimumInterval
        self.now = now
    }

    public func begin() -> Begin {
        if inFlight { return .busy }
        if let last {
            if now() - last.at < minimumInterval { return .reuse(last.value) }
            self.last = nil
        }
        inFlight = true
        return .run
    }

    // Ends a run started by `begin`; a nil value (a failed capture) is not kept.
    public func finish(_ value: Value?) {
        inFlight = false
        last = value.map { (now(), $0) }
    }
}

// [DOMAIN] Bounds a captured frame before it is encoded: the long edge is capped
// so a Retina window never becomes a multi-megabyte image.
public enum FrameSize {
    public static let maxLongEdge = 1568

    public static func fit(width: Int, height: Int, maxLongEdge: Int = FrameSize.maxLongEdge) -> (width: Int, height: Int) {
        let w = max(1, width), h = max(1, height)
        let long = max(w, h)
        guard long > maxLongEdge else { return (w, h) }
        let scale = Double(maxLongEdge) / Double(long)
        return (max(1, Int((Double(w) * scale).rounded())), max(1, Int((Double(h) * scale).rounded())))
    }
}
