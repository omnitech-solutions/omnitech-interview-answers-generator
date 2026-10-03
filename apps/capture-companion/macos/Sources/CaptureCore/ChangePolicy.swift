import Foundation

// [DOMAIN] Meaningful-change screenshot gate (D6): a frame is sent only when it
// differs perceptually from the last sent frame, no sooner than the minimum
// interval, and never beyond the per-session cap from the contract limits. The
// companion never sends every frame and never keeps frames on disk.

// Frames reach the policy as a 9x8 grid of luma values (72 bytes); the adapter
// does the pixel work, so this policy runs and tests without a framework.
public protocol PerceptualFrame {
    // Row-major 9 columns x 8 rows, 0...255.
    var lumaGrid: [UInt8] { get }
}

public enum PerceptualHash {
    public static let gridColumns = 9
    public static let gridRows = 8

    // [STRATEGY] Difference hash: one bit per horizontally adjacent pair says
    // whether brightness falls. Robust to scaling and compression noise.
    public static func difference(_ grid: [UInt8]) -> UInt64? {
        guard grid.count == gridColumns * gridRows else { return nil }
        var hash: UInt64 = 0
        for row in 0..<gridRows {
            for column in 0..<(gridColumns - 1) {
                let left = grid[row * gridColumns + column]
                let right = grid[row * gridColumns + column + 1]
                hash = (hash << 1) | (left > right ? 1 : 0)
            }
        }
        return hash
    }

    public static func distance(_ a: UInt64, _ b: UInt64) -> Int { (a ^ b).nonzeroBitCount }
}

public enum ChangeDecision: Equatable, Sendable {
    case send
    case skipUnchanged
    case skipTooSoon
    case skipSessionCap
    case skipUnreadableFrame
}

public struct ChangePolicy {
    public let distanceThreshold: Int
    public let minimumInterval: TimeInterval
    public let sessionCap: Int
    public private(set) var sentCount = 0
    private var lastHash: UInt64?
    private var lastSentAt: Date?

    public init(
        distanceThreshold: Int = 10, minimumInterval: TimeInterval = 15,
        sessionCap: Int = ActiveSessionLimits.maxScreenshotsPerSession
    ) {
        self.distanceThreshold = distanceThreshold
        self.minimumInterval = minimumInterval
        self.sessionCap = min(sessionCap, ActiveSessionLimits.maxScreenshotsPerSession)
    }

    // [GUARD] Cap first (hard limit), then interval, then change; only a sent
    // frame updates the reference hash, so slow drift still triggers eventually.
    public mutating func evaluate(_ frame: some PerceptualFrame, at time: Date) -> ChangeDecision {
        guard let hash = PerceptualHash.difference(frame.lumaGrid) else { return .skipUnreadableFrame }
        if sentCount >= sessionCap { return .skipSessionCap }
        if let lastSentAt, time.timeIntervalSince(lastSentAt) < minimumInterval { return .skipTooSoon }
        if let lastHash, PerceptualHash.distance(lastHash, hash) < distanceThreshold {
            return .skipUnchanged
        }
        lastHash = hash
        lastSentAt = time
        sentCount += 1
        return .send
    }
}
