import CaptureCore
import Foundation

// [DOMAIN] What the embedded hands-free engine tells the person and the pages
// (ADR-0022): which sources listen, whether Studio can be reached, how long
// since speech was last heard, and the one action needed when something is
// missing. Every value is a closed set or a number; there is no free text from
// Studio, no transcript and no credential in it, so it is safe to hand to a page.

public enum EngineSourceKind: String, CaseIterable, Sendable {
    case microphone
    case systemAudio = "system-audio"
    case screen

    public init(_ source: CaptureSource) {
        switch source {
        case .microphone: self = .microphone
        case .applicationAudio: self = .systemAudio
        case .screen: self = .screen
        }
    }

    public var captureSource: CaptureSource {
        switch self {
        case .microphone: .microphone
        case .systemAudio: .applicationAudio
        case .screen: .screen
        }
    }
}

public enum SourceHealth: String, Equatable, Sendable {
    // Not part of this session, paused by Studio, or stopped.
    case off
    case starting
    case listening
    // The device or stream went away; the engine retries by itself.
    case lost
    case permissionDenied = "permission-denied"
    // Studio refused it, or the Mac cannot do it (for example no on-device speech).
    case unavailable
}

public enum PairingStage: String, Equatable, Sendable {
    // Nothing was asked of the engine (Studio has not issued engine.start, or it was stopped).
    case idle
    case waitingForSignIn = "waiting-for-sign-in"
    case pairing
    case paired
    case renewing
    case unreachable
    case failed
    // The person stopped listening on this Mac; it stays stopped until Studio starts it again.
    case stopped
    // Studio ended the session; the engine did what it was told and stopped.
    case ended
}

public struct EngineSnapshot: Equatable, Sendable {
    public static let bridgeVersion = 1

    public var stage: PairingStage
    public var sources: [EngineSourceKind: SourceHealth]
    public var paused: Bool
    public var lastHeardAgeSeconds: Int?
    public var speechFailure: SpeechFailure?

    public init(
        stage: PairingStage = .idle, sources: [EngineSourceKind: SourceHealth] = [:], paused: Bool = false,
        lastHeardAgeSeconds: Int? = nil, speechFailure: SpeechFailure? = nil
    ) {
        self.stage = stage
        self.sources = sources
        self.paused = paused
        self.lastHeardAgeSeconds = lastHeardAgeSeconds
        self.speechFailure = speechFailure
    }

    public func health(_ kind: EngineSourceKind) -> SourceHealth { sources[kind] ?? .off }

    public var isListening: Bool { EngineSourceKind.allCases.contains { health($0) == .listening } && !paused }

    // [DOMAIN] The one line to show, naming the one action needed, or nil when
    // nothing is needed. Permission loss is never softened into "listening":
    // the first thing to fix is named first (speech, microphone, screen).
    public var hint: String? {
        if speechFailure == .notAuthorized {
            return "Grant Speech Recognition in System Settings › Privacy & Security."
        }
        if let failure = speechFailure {
            switch failure {
            case .localeUnsupported:
                return "Speech recognition does not support this language on this Mac, so nothing is listening."
            case .onDeviceUnsupported:
                return "This Mac cannot recognise speech on the device, so nothing is listening."
            case .recognizerUnavailable:
                return "On-device speech recognition is not available right now; nothing is listening."
            case .notAuthorized: break
            }
        }
        if health(.microphone) == .permissionDenied {
            return "Grant Microphone in System Settings › Privacy & Security."
        }
        if health(.systemAudio) == .permissionDenied || health(.screen) == .permissionDenied {
            return "Grant Screen Recording in System Settings › Privacy & Security."
        }
        switch stage {
        case .waitingForSignIn: return "Sign in to Studio to start listening."
        case .unreachable: return "Studio is not reachable; trying again."
        case .failed: return "Pairing with Studio failed; trying again shortly."
        default: return nil
        }
    }

    // The typed, bounded value the page receives (HostBridge `engineState`).
    public var bridgeValue: [String: Any] {
        var sourceValues: [String: String] = [:]
        for kind in EngineSourceKind.allCases { sourceValues[kind.rawValue] = health(kind).rawValue }
        var value: [String: Any] = [
            "v": Self.bridgeVersion,
            "pairing": stage.rawValue,
            "listening": isListening,
            "paused": paused,
            "sources": sourceValues,
            "lastHeardAgeSeconds": lastHeardAgeSeconds.map { min(max($0, 0), 86_400) } as Any? ?? NSNull(),
            "hint": hint as Any? ?? NSNull(),
        ]
        if let speechFailure { value["speech"] = speechFailure.rawValue }
        return value
    }
}

// What issuing or renewing a credential returned. Its description never shows the value.
public struct IssuedCredential: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let value: String
    public let expiresAt: Date

    public init(value: String, expiresAt: Date) {
        self.value = value
        self.expiresAt = expiresAt
    }

    // POST .../sessions/:id/credential -> { credential: { value, expiresAt } }
    public static func parse(_ json: String) -> IssuedCredential? {
        guard let data = json.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let row = root["credential"] as? [String: Any],
            let value = row["value"] as? String, Endpoint.isCredentialShape(value),
            let text = row["expiresAt"] as? String, let expires = TimeText.parse(text)
        else { return nil }
        return IssuedCredential(value: value, expiresAt: expires)
    }

    public var description: String { "IssuedCredential(redacted)" }
    public var debugDescription: String { description }
}
