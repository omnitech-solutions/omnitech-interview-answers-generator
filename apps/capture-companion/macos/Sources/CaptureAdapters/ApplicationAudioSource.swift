import CaptureCore
import Foundation

// What the tap has shown of itself, shared by every source in the process
// (there is one call and one tap) and read by the permission report.
// [SAFETY] INVARIANT (@unchecked Sendable): `value` is only touched inside `lock.withLock`.
private final class TapEvidenceBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = TapEvidence.untried
    func get() -> TapEvidence { lock.withLock { value } }
    func set(_ next: TapEvidence) { lock.withLock { value = next } }
    // A tap that already proved itself is not demoted by a later quiet start.
    func markRunning() { lock.withLock { if value != .heardSound { value = .runningSilent } } }
}

// [DOMAIN] The call's audio as ONE source with two ways to capture it. The
// person's setting says which; ScreenCaptureKit is the default and is used
// exactly as before. With the tap chosen, a tap that cannot run (older macOS,
// a failed step, no buffers) falls back to ScreenCaptureKit and records why as
// a code. Either way the same AudioFrame values reach the same `onAudio`, and
// a loss reaches the same `onLost`, so nothing downstream knows which ran.
// [SAFETY] INVARIANT (@unchecked Sendable): `tap` and `wanted` are only touched
// inside `lock.withLock`; the rest are immutable `let`s. It inherits the
// unordered start/stop overlap noted on ScreenKitSource for that path.
public final class ApplicationAudioSource: @unchecked Sendable {
    private static let evidence = TapEvidenceBox()

    private let preference: CallAudioSource
    private let onAudio: @Sendable (AudioFrame) -> Void
    private let onLost: @Sendable (DisconnectReason) -> Void
    private let screenKit: ScreenKitSource
    private let lock = NSLock()
    // The running ProcessTapSource (typed loosely: the class exists from macOS 14.4).
    private var tap: AnyObject?
    private var wanted = false

    public init(
        preference: CallAudioSource, onAudio: @escaping @Sendable (AudioFrame) -> Void,
        onLost: @escaping @Sendable (DisconnectReason) -> Void
    ) {
        self.preference = preference
        self.onAudio = onAudio
        self.onLost = onLost
        screenKit = ScreenKitSource(
            kind: .applicationAudio, onAudio: onAudio, onScreenshot: { _, _ in }, onLost: onLost)
    }

    // Which capture carries the call's audio for this preference right now,
    // and why a chosen tap does not.
    public static func carrier(for preference: CallAudioSource) -> (source: CallAudioSource, reason: TapUnavailableReason?) {
        let system = ProcessInfo.processInfo.operatingSystemVersion
        return CallAudioPlan.attempt(
            preference: preference, osMajor: system.majorVersion, osMinor: system.minorVersion,
            evidence: evidence.get())
    }

    public static var tapEvidence: TapEvidence { evidence.get() }

    // The person chose again: a tap that failed earlier gets a fresh attempt.
    public static func forgetTapEvidence() { evidence.set(.untried) }

    // Returns false (after reporting why through `onLost`) when nothing could start.
    public func start() async -> Bool {
        lock.withLock { wanted = true }
        let plan = Self.carrier(for: preference)
        if let reason = plan.reason { Self.recordUnavailable(reason) }
        if plan.source == .processTap, #available(macOS 14.4, *), startTap() { return true }
        return await screenKit.start()
    }

    public func stop() async {
        let running = lock.withLock { () -> AnyObject? in
            wanted = false
            defer { tap = nil }
            return tap
        }
        if #available(macOS 14.4, *), let running = running as? ProcessTapSource {
            running.stop()
            CompanionEvents.record(.system, "audio.tap_stopped", ["reason": "stopped"])
        }
        await screenKit.stop()
    }

    @available(macOS 14.4, *)
    private func startTap() -> Bool {
        let source = ProcessTapSource(
            onAudio: onAudio, onSound: { Self.evidence.set(.heardSound) },
            onEnd: { [weak self] end in self?.tapEnded(end) })
        if let reason = source.start() {
            Self.evidence.set(.failed(reason))
            Self.recordUnavailable(reason)
            return false
        }
        // [GUARD] A stop that arrived while the tap was being built wins.
        let keep = lock.withLock { () -> Bool in
            if wanted { tap = source }
            return wanted
        }
        guard keep else {
            source.stop()
            return true
        }
        Self.evidence.markRunning()
        CompanionEvents.record(.system, "audio.tap_started")
        return true
    }

    // The tap tore itself down (it has already destroyed its IOProc, device and tap).
    @available(macOS 14.4, *)
    private func tapEnded(_ end: ProcessTapSource.End) {
        let stillWanted = lock.withLock { () -> Bool in
            tap = nil
            return wanted
        }
        switch end {
        case .neverDelivered:
            // The tap does not work on this Mac: the call's audio moves to
            // ScreenCaptureKit for the rest of this launch.
            Self.evidence.set(.failed(.noBuffers))
            Self.recordUnavailable(.noBuffers)
            guard stillWanted else { return }
            Task { _ = await self.screenKit.start() }
        case .stalled:
            CompanionEvents.record(.system, "audio.tap_stopped", ["reason": "stalled"])
            if stillWanted { onLost(.deviceLost) }
        }
    }

    private static func recordUnavailable(_ reason: TapUnavailableReason) {
        CompanionEvents.record(.system, "audio.tap_unavailable", ["reason": reason.rawValue])
    }
}
