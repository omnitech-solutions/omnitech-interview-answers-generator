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
