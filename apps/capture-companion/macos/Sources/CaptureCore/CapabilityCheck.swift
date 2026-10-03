// [DOMAIN] Visible on-device speech capability check (ADR-0012/declared-profile-locality).
// Transcription happens only in the companion with the OS's on-device
// recogniser. If the locale, the on-device model, the recogniser or the
// authorisation is missing, the check fails visibly: no audio source starts and
// there is no other recognition path to fall back to. Core has no API that
// could select anything else; the adapter edge asks for on-device only.

public enum SpeechFailure: String, Equatable, Sendable {
    case localeUnsupported = "locale-unsupported"
    case onDeviceUnsupported = "on-device-unsupported"
    case recognizerUnavailable = "recognizer-unavailable"
    case notAuthorized = "not-authorized"
}

// What the OS says, supplied by the adapter. Plain facts, no behaviour.
public struct SpeechProbeResult: Equatable, Sendable {
    public let localeSupported: Bool
    public let onDeviceSupported: Bool
    public let recognizerAvailable: Bool
    public let authorization: SpeechAuthorization

    public init(
        localeSupported: Bool, onDeviceSupported: Bool, recognizerAvailable: Bool,
        authorization: SpeechAuthorization
    ) {
        self.localeSupported = localeSupported
        self.onDeviceSupported = onDeviceSupported
        self.recognizerAvailable = recognizerAvailable
        self.authorization = authorization
    }
}

public protocol SpeechCapabilityProbe: Sendable {
    func probe(locale: String) async -> SpeechProbeResult
}

public protocol PermissionProbe: Sendable {
    func microphone() async -> PermissionState
    func screen() async -> PermissionState
}

public struct CapabilityOutcome: Equatable, Sendable {
    public let report: CapabilityReport
    // nil means every check passed.
    public let failure: SpeechFailure?

    public init(report: CapabilityReport, failure: SpeechFailure?) {
        self.report = report
        self.failure = failure
    }

    // Audio sources may start only when nothing failed.
    public var mayStartAudioSources: Bool { failure == nil }
}

public enum CapabilityCheck {
    // [STRATEGY] Check in the order a person would fix them (language, model,
    // recogniser, permission) and report the first failure; the report always
    // goes to Studio so Setup can say why.
    public static func evaluate(
        locale: String, speech: SpeechCapabilityProbe, permissions: PermissionProbe,
        sourceId: String, sentAt: String
    ) async -> CapabilityOutcome {
        let result = await speech.probe(locale: locale)
        let failure: SpeechFailure?
        if !result.localeSupported {
            failure = .localeUnsupported
        } else if !result.onDeviceSupported {
            failure = .onDeviceUnsupported
        } else if !result.recognizerAvailable {
            failure = .recognizerUnavailable
        } else if result.authorization != .authorized {
            failure = .notAuthorized
        } else {
            failure = nil
        }
        let report = CapabilityReport(
            sourceId: sourceId,
            sentAt: sentAt,
            speech: SpeechCapabilityReport(
                locale: locale,
                onDeviceAvailable: result.localeSupported && result.onDeviceSupported,
                recognizerAvailable: result.recognizerAvailable,
                authorizationStatus: result.authorization),
            microphone: await permissions.microphone(),
            screen: await permissions.screen())
        return CapabilityOutcome(report: report, failure: failure)
    }
}
