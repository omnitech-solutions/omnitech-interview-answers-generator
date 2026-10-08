// [DOMAIN] How the call's audio (the other side of a FaceTime, Zoom, Meet or
// Teams call, or a browser tab) is captured. `screenCaptureKit` is the default
// and what every earlier build did: an SCStream open for the whole session, so
// macOS shows its purple "Currently Sharing" indicator. `processTap` is a Core
// Audio process tap (macOS 14.4+): no stream, no sharing indicator, its own
// "System Audio Recording Only" permission. The choice is the person's; a tap
// that cannot run falls back to ScreenCaptureKit and says why as a code.
public enum CallAudioSource: String, CaseIterable, Sendable {
    case screenCaptureKit
    case processTap

    public static let `default` = CallAudioSource.screenCaptureKit

    // [GUARD] A stored or page-sent value is untrusted: anything that is not
    // exactly one of the two names is the default, never a guess.
    public static func parse(_ raw: String?) -> CallAudioSource {
        raw.flatMap(CallAudioSource.init(rawValue:)) ?? .default
    }

    // Process taps exist from macOS 14.4.
    public static func tapSupported(osMajor: Int, osMinor: Int) -> Bool {
        osMajor > 14 || (osMajor == 14 && osMinor >= 4)
    }
}

// Why a selected tap did not run (`audio.tap_unavailable`): a closed set of
// codes, never an OS error message.
public enum TapUnavailableReason: String, Equatable, Sendable {
    case osTooOld = "os-too-old"
    case tapCreateFailed = "tap-create-failed"
    case formatUnreadable = "format-unreadable"
    case aggregateCreateFailed = "aggregate-create-failed"
    case ioProcFailed = "io-proc-failed"
    case startFailed = "start-failed"
    // Created and started, but no buffer ever arrived.
    case noBuffers = "no-buffers"
}

// What the tap has shown of itself since launch (or since the person last
// chose it). macOS has no public way to ask whether System Audio Recording is
// allowed: a refused tap is created and started like any other and delivers
// silence. So "allowed" is only claimed once real sound arrived.
public enum TapEvidence: Equatable, Sendable {
    case untried
    case failed(TapUnavailableReason)
    case runningSilent
    case heardSound
}

public enum CallAudioPlan {
    // [STRATEGY] The one start decision: which capture carries the call's
    // audio. ScreenCaptureKit unless the person chose the tap, this macOS has
    // it, and it has not already failed; `reason` says why a chosen tap is not
    // used. A tap that failed stays failed until the person chooses it again
    // or the app restarts, so a broken tap is not retried on every resume.
    public static func attempt(
        preference: CallAudioSource, osMajor: Int, osMinor: Int, evidence: TapEvidence
    ) -> (source: CallAudioSource, reason: TapUnavailableReason?) {
        guard preference == .processTap else { return (.screenCaptureKit, nil) }
        guard CallAudioSource.tapSupported(osMajor: osMajor, osMinor: osMinor) else {
            return (.screenCaptureKit, .osTooOld)
        }
        if case .failed(let reason) = evidence { return (.screenCaptureKit, reason) }
        return (.processTap, nil)
    }
}
