import CaptureCore
import Foundation

// [DOMAIN] ScreenWatch (ADR-0019 host adapter): the native side only *notices*
// that the watched screen content changed and tells Studio; Studio decides what
// that means (an Auto capture). The shell never creates an assist request.
// [SAFETY] Frames are reduced to a 9x8 grey grid inside the sampler, hashed and
// dropped: no frame is stored, sent or logged. Only `{at, bits}` leaves.

// What the page asked to watch. The region is normalised to the display.
public struct ScreenWatchRequest: Equatable, Sendable {
    public enum Mode: String, Sendable { case focusedWindow = "focused-window", region }

    public static let defaultIntervalMs = 2000
    public static let minimumIntervalMs = 1000
    public static let maximumIntervalMs = 10_000

    public let mode: Mode
    public let region: CaptureRegion?
    public let displayId: UInt32?
    public let intervalMs: Int

    public init(mode: Mode, region: CaptureRegion? = nil, displayId: UInt32? = nil, intervalMs: Int = defaultIntervalMs) {
        self.mode = mode
        self.region = region
        self.displayId = displayId
        self.intervalMs = Self.clampInterval(intervalMs)
    }

    // [GUARD] Never faster than once a second, never slower than a page could mean.
    public static func clampInterval(_ ms: Int) -> Int { min(maximumIntervalMs, max(minimumIntervalMs, ms)) }
}

public enum ScreenWatchFailure: String, Sendable {
    case permissionDenied = "permission-denied"
    case noFocusedWindow = "no-focused-window"
    case displayChanged = "display-changed"
    case invalid
}

public struct ScreenWatchStatus: Equatable, Sendable {
    public let watching: Bool
    public let reason: String?
    public static let idle = ScreenWatchStatus(watching: false, reason: nil)
    public init(watching: Bool, reason: String? = nil) {
        self.watching = watching
        self.reason = reason
    }

    public var wire: [String: Any] {
        var value: [String: Any] = ["watching": watching]
        if let reason { value["reason"] = reason }
        return value
    }
}

// [STRATEGY] Settled-change detector over dHash grids. A frame that differs
// from the baseline (the last emitted frame, or the first ever) by at least
// `changeBits` of 64 starts a candidate; once the screen then holds still (each
// frame within `stableBits` of the candidate) for `settleSeconds`, ONE event is
// emitted and the settled frame becomes the new baseline. Scrolling, loading
// and animation keep resetting the candidate, so they emit nothing until calm;
// returning to the baseline cancels the candidate.
public struct ScreenChangeDetector: Sendable {
    public struct Event: Equatable, Sendable {
        public let bits: Int
    }

    public let changeBits: Int
    public let stableBits: Int
    public let settleSeconds: TimeInterval
    private var baseline: UInt64?
    private var candidate: UInt64?
    private var stableSince: TimeInterval = 0

    public init(changeBits: Int = 12, stableBits: Int = 6, settleSeconds: TimeInterval = 3) {
        self.changeBits = changeBits
        self.stableBits = stableBits
        self.settleSeconds = settleSeconds
    }

    // Forget everything (a new watch begins).
    public mutating func reset() {
        baseline = nil
        candidate = nil
    }

    // `hash` is the dHash of the frame sampled at `now` (monotonic seconds).
    public mutating func observe(hash: UInt64, now: TimeInterval) -> Event? {
        guard let base = baseline else {
            baseline = hash
            return nil
        }
        // [GUARD] Back near the baseline: whatever was pending was transient.
        let fromBaseline = PerceptualHash.distance(base, hash)
        guard fromBaseline >= changeBits else {
            candidate = nil
            return nil
        }
        // [STATE] Still moving (or a new candidate): restart the stability clock.
        guard let held = candidate, PerceptualHash.distance(held, hash) < stableBits else {
            candidate = hash
            stableSince = now
            return nil
        }
        // [STRATEGY] Held still long enough: one event, then rebaseline.
        guard now - stableSince >= settleSeconds else { return nil }
        baseline = hash
        candidate = nil
        return Event(bits: fromBaseline)
    }
}

// What one tick of a sampler produced. A grid is 9x8 grey luma, row-major.
public enum ScreenWatchSample: Equatable, Sendable {
    case grid([UInt8])
    case noWindow
    case permissionDenied
    case displayChanged
}

@MainActor
public protocol ScreenWatchSampler: AnyObject {
    func sample(_ request: ScreenWatchRequest) async -> ScreenWatchSample
}

// [DOMAIN] Runs the sampler on an interval and turns settled changes into
// events. Studio starts and stops it; permission loss or a changed display ends
// the watch with a typed status. `tick` is the whole per-sample step, so tests
// drive it with a fake sampler and no timers.
@MainActor
public final class ScreenWatcher {
    private let sampler: ScreenWatchSampler
    private let now: () -> TimeInterval
    private var detector = ScreenChangeDetector()
    private var request: ScreenWatchRequest?
    private var loop: Task<Void, Never>?
    public private(set) var status = ScreenWatchStatus.idle

    // `at` is wall-clock milliseconds, for the page to order events by.
    public var onChange: (_ at: Int, _ bits: Int) -> Void = { _, _ in }
    public var onStatus: (ScreenWatchStatus) -> Void = { _ in }

    public init(sampler: ScreenWatchSampler, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.sampler = sampler
        self.now = now
    }

    public var isWatching: Bool { request != nil }

    // Begins watching after one probe that proves the capability works now.
    public func start(_ next: ScreenWatchRequest, runLoop: Bool = true) async -> ScreenWatchFailure? {
        stopQuietly()
        switch await sampler.sample(next) {
        case .permissionDenied: return fail(.permissionDenied)
        case .noWindow: return fail(.noFocusedWindow)
        case .displayChanged: return fail(.displayChanged)
        case .grid(let grid):
            guard let hash = PerceptualHash.difference(grid) else { return fail(.invalid) }
            detector.reset()
            _ = detector.observe(hash: hash, now: now())
            request = next
            publish(ScreenWatchStatus(watching: true))
            if runLoop { startLoop(interval: next.intervalMs) }
            return nil
        }
    }

    public func stop() {
        guard request != nil || status.watching else { return }
        stopQuietly()
        publish(.idle)
    }

    // One sample. A transient lack of a window is skipped (the shell itself, or
    // a switch in progress); permission loss and a moved display end the watch.
    public func tick() async {
        guard let active = request else { return }
        let sample = await sampler.sample(active)
        // [GUARD] Stopped (or restarted) while the sample was in flight.
        guard request == active else { return }
        switch sample {
        case .noWindow: return
        case .permissionDenied: endWatch(.permissionDenied)
        case .displayChanged: endWatch(.displayChanged)
        case .grid(let grid):
            guard let hash = PerceptualHash.difference(grid) else { return }
            if let event = detector.observe(hash: hash, now: now()) {
                onChange(Int(Date().timeIntervalSince1970 * 1000), event.bits)
            }
        }
    }

    private func startLoop(interval: Int) {
        loop = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000)
                guard !Task.isCancelled, let self else { return }
                await self.tick()
            }
        }
    }

    private func stopQuietly() {
        loop?.cancel()
        loop = nil
        request = nil
        detector.reset()
    }

    private func endWatch(_ reason: ScreenWatchFailure) {
        stopQuietly()
        publish(ScreenWatchStatus(watching: false, reason: reason.rawValue))
    }

    private func fail(_ reason: ScreenWatchFailure) -> ScreenWatchFailure {
        publish(ScreenWatchStatus(watching: false, reason: reason.rawValue))
        return reason
    }

    private func publish(_ next: ScreenWatchStatus) {
        guard next != status else { return }
        status = next
        onStatus(next)
    }
}

// [GUARD] The page's start parameters are untrusted: a known mode, a region
// exactly when the mode is "region", a display id that is a plain uint32, and an
// interval that is a finite number (clamped, never rejected for being fast).
public enum ScreenWatchDecoder {
    public static func decodeStart(_ params: [String: Any]) -> ScreenWatchRequest? {
        guard Set(params.keys).isSubset(of: ["mode", "region", "displayId", "intervalMs"]),
            let text = params["mode"] as? String, let mode = ScreenWatchRequest.Mode(rawValue: text)
        else { return nil }
        var displayId: UInt32?
        if let raw = params["displayId"], !(raw is NSNull) {
            guard let value = number(raw), value >= 0, value <= Double(UInt32.max), value == value.rounded() else {
                return nil
            }
            displayId = UInt32(value)
        }
        var interval = ScreenWatchRequest.defaultIntervalMs
        if let raw = params["intervalMs"], !(raw is NSNull) {
            guard let value = number(raw), value.isFinite else { return nil }
            interval = Int(min(Double(ScreenWatchRequest.maximumIntervalMs), max(0, value)))
        }
        let rawRegion = params["region"]
        let hasRegion = rawRegion != nil && !(rawRegion is NSNull)
        guard mode == .region else {
            return hasRegion ? nil : ScreenWatchRequest(mode: mode, displayId: displayId, intervalMs: interval)
        }
        guard let fields = rawRegion as? [String: Any],
            let x = number(fields["x"]), let y = number(fields["y"]),
            let width = number(fields["width"]), let height = number(fields["height"]),
            [x, y, width, height].allSatisfy({ $0.isFinite }),
            x >= 0, y >= 0, width > 0, height > 0, x + width <= 1, y + height <= 1
        else { return nil }
        return ScreenWatchRequest(
            mode: .region, region: CaptureRegion(x: x, y: y, width: width, height: height),
            displayId: displayId, intervalMs: interval)
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
}
