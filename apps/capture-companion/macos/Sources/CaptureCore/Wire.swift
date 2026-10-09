import Foundation

// [DOMAIN] Swift mirror of the versioned Active Session wire
// (packages/active-session-contracts, schema/active-session-wire.schema.json).
// The companion consumes only this wire (rule:versioned-wire-contract); the
// validator below is strict on purpose: unknown fields refused, version 1 only,
// bounds from the schema, and identity-shaped field names refused anywhere
// (rule:identity-from-credential). The corpus in the contracts package is the
// shared conformance suite for this file.

public let wireVersion = 1

// MARK: - Issues

public enum IssueCode: String, Equatable, Sendable {
    case identityFieldForbidden = "identity_field_forbidden"
    case unsupportedVersion = "unsupported_version"
    case unknownKind = "unknown_kind"
    case unknownField = "unknown_field"
    case invalidType = "invalid_type"
    case invalidValue = "invalid_value"
    case invalidFormat = "invalid_format"
    case tooLarge = "too_large"
    case tooSmall = "too_small"
}

public enum PathPart: Equatable, Sendable {
    case key(String)
    case index(Int)
}

// [SAFETY] An issue names a path and a stable code only, never the value.
public struct WireIssue: Equatable, Sendable {
    public let path: [PathPart]
    public let code: IssueCode
}

public enum WireResult<Value: Sendable>: Sendable {
    case ok(Value)
    case failure([WireIssue])

    public var value: Value? {
        if case .ok(let value) = self { return value }
        return nil
    }

    public var issueCodes: [String] {
        if case .failure(let issues) = self { return issues.map { $0.code.rawValue } }
        return []
    }
}

// MARK: - Vocabulary

public enum CaptureSource: String, CaseIterable, Sendable {
    case microphone
    case applicationAudio = "application-audio"
    case screen
}

public enum TranscriptSource: String, Sendable {
    case microphone
    case applicationAudio = "application-audio"
}

public enum ScreenMediaType: String, Sendable {
    case png = "image/png"
    case jpeg = "image/jpeg"
    case webp = "image/webp"
}

public enum DisconnectReason: String, Sendable {
    case userStopped = "user-stopped"
    case permissionRevoked = "permission-revoked"
    case deviceLost = "device-lost"
    case error
}

public enum GapReason: String, Sendable {
    case bufferOverflow = "buffer-overflow"
    case sourceInterrupted = "source-interrupted"
    case paused
    case error
}

public enum SpeechAuthorization: String, Sendable {
    case authorized, denied, restricted
    case notDetermined = "not-determined"
}

public enum PermissionState: String, Sendable {
    case granted, denied
    case notDetermined = "not-determined"
}

public enum ControlState: String, Sendable {
    case active, paused, ended, purging
}

public enum RefusalCode: String, CaseIterable, Sendable {
    case credentialRefused = "credential_refused"
    case sessionPaused = "session_paused"
    case sessionEnded = "session_ended"
    case sessionPurging = "session_purging"
    case invalidObservation = "invalid_observation"
    case unsupportedVersion = "unsupported_version"
    case envelopeTooLarge = "envelope_too_large"
    case payloadTooLarge = "payload_too_large"
    case rateLimited = "rate_limited"
    case limitReached = "limit_reached"
    case eventConflict = "event_conflict"
    // A screenshot named a capture request that is not the pending one; nothing was stored.
    case captureRequestStale = "capture_request_stale"
    // Studio does not take voice activity (switched off, or a device-only
    // session): no more is sent for the rest of this run.
    case voiceActivityOff = "voice_activity_off"
}

// Why a capture request could not be honoured: a closed set of content-free codes (ADR-0020).
public enum CaptureFailureCode: String, CaseIterable, Sendable {
    case noFocusedWindow = "no-focused-window"
    case permissionDenied = "permission-denied"
    // The screen source is not running (paused, lost, refused or never selected).
    case sourceGone = "source-gone"
    // The screen selection a region was drawn against is no longer the selected one.
    case sourceChanged = "source-changed"
    case captureFailed = "capture-failed"
}

// MARK: - Messages

public struct Envelope: Equatable, Sendable {
    public let sourceId: String
    public let eventId: String
    public let occurredAt: String
    public let sequence: Int

    public init(sourceId: String, eventId: String, occurredAt: String, sequence: Int) {
        self.sourceId = sourceId
        self.eventId = eventId
        self.occurredAt = occurredAt
        self.sequence = sequence
    }
}

public struct TranscriptContent: Equatable, Sendable {
    public let speaker: String
    public let source: TranscriptSource?
    public let text: String
    public let startMs: Int
    public let endMs: Int
    public let supersedes: String?

    public init(
        speaker: String, source: TranscriptSource?, text: String, startMs: Int, endMs: Int,
        supersedes: String? = nil
    ) {
        self.speaker = speaker
        self.source = source
        self.text = text
        self.startMs = startMs
        self.endMs = endMs
        self.supersedes = supersedes
    }
}

public struct ScreenContent: Equatable, Sendable {
    public let payloadRef: String
    public let mediaType: ScreenMediaType
    public let byteLength: Int
    public let windowLabel: String
    // Set only to the id of the capture request just handed over in
    // `control.capture`; Studio honours it against its own pending request only.
    public let requestId: String?

    public init(
        payloadRef: String, mediaType: ScreenMediaType, byteLength: Int, windowLabel: String,
        requestId: String? = nil
    ) {
        self.payloadRef = payloadRef
        self.mediaType = mediaType
        self.byteLength = byteLength
        self.windowLabel = windowLabel
        self.requestId = requestId
    }
}

public enum ObservationBody: Equatable, Sendable {
    case transcriptFinal(TranscriptContent)
    case screenSnapshot(ScreenContent)
    case sourceDisconnected(source: CaptureSource, reason: DisconnectReason)
    case captureGap(source: CaptureSource, durationMs: Int, reason: GapReason)
}

public struct Observation: Equatable, Sendable {
    public let envelope: Envelope
    public let body: ObservationBody

    public init(envelope: Envelope, body: ObservationBody) {
        self.envelope = envelope
        self.body = body
    }

    // The capture source this observation came from, used to attribute a
    // refusal to one source.
    public var captureSource: CaptureSource {
        switch body {
        case .transcriptFinal(let content):
            return content.source == .applicationAudio ? .applicationAudio : .microphone
        case .screenSnapshot: return .screen
        case .sourceDisconnected(let source, _): return source
        case .captureGap(let source, _, _): return source
        }
    }

    public var isContent: Bool {
        switch body {
        case .transcriptFinal, .screenSnapshot: return true
        case .sourceDisconnected, .captureGap: return false
        }
    }
}

// The companion's state as codes (never content): what it is doing, each
// selected source's status, and a speech failure if any. Optional on the wire,
// so an older Studio that does not know it still accepts the heartbeat.
public struct HeartbeatDiagnostics: Equatable, Sendable {
    public let state: String
    public let sources: [String: String]
    public let speechFailure: String?

    public init(state: String, sources: [String: String], speechFailure: String?) {
        self.state = state
        self.sources = sources
        self.speechFailure = speechFailure
    }
}

public struct Heartbeat: Equatable, Sendable {
    public let sourceId: String
    public let sentAt: String
    public let capturing: Bool
    public let diagnostics: HeartbeatDiagnostics?

    public init(sourceId: String, sentAt: String, capturing: Bool, diagnostics: HeartbeatDiagnostics? = nil) {
        self.sourceId = sourceId
        self.sentAt = sentAt
        self.capturing = capturing
        self.diagnostics = diagnostics
    }
}

public struct SpeechCapabilityReport: Equatable, Sendable {
    public let locale: String
    public let onDeviceAvailable: Bool
    public let recognizerAvailable: Bool
    public let authorizationStatus: SpeechAuthorization

    public init(
        locale: String, onDeviceAvailable: Bool, recognizerAvailable: Bool,
        authorizationStatus: SpeechAuthorization
    ) {
        self.locale = locale
        self.onDeviceAvailable = onDeviceAvailable
        self.recognizerAvailable = recognizerAvailable
        self.authorizationStatus = authorizationStatus
    }
}

public struct CapabilityReport: Equatable, Sendable {
    public let sourceId: String
    public let sentAt: String
    public let speech: SpeechCapabilityReport
    public let microphone: PermissionState
    public let screen: PermissionState

    public init(
        sourceId: String, sentAt: String, speech: SpeechCapabilityReport,
        microphone: PermissionState, screen: PermissionState
    ) {
        self.sourceId = sourceId
        self.sentAt = sentAt
        self.speech = speech
        self.microphone = microphone
        self.screen = screen
    }
}

public enum IngestMessage: Equatable, Sendable {
    case observation(Observation)
    case heartbeat(Heartbeat)
    case capabilityReport(CapabilityReport)
    case captureFailure(CaptureFailure)
    case voiceActivity(VoiceActivity)
}

// Whether a voice is being heard on one audio source right now. A transient
// signal, not content and not an observation: no event id, no sequence, never
// queued and never resent.
public struct VoiceActivity: Equatable, Sendable {
    public let sourceId: String
    public let sentAt: String
    public let source: TranscriptSource
    public let speaking: Bool

    public init(sourceId: String, sentAt: String, source: TranscriptSource, speaking: Bool) {
        self.sourceId = sourceId
        self.sentAt = sentAt
        self.source = source
        self.speaking = speaking
    }
}

// The companion could not capture for one request: correlated by id, bounded to a closed code.
// Sent only after Studio handed over a request, which only a negotiating Studio does.
public struct CaptureFailure: Equatable, Sendable {
    public let sourceId: String
    public let sentAt: String
    public let requestId: String
    public let code: CaptureFailureCode

    public init(sourceId: String, sentAt: String, requestId: String, code: CaptureFailureCode) {
        self.sourceId = sourceId
        self.sentAt = sentAt
        self.requestId = requestId
        self.code = code
    }
}

// MARK: - Acknowledgements

// What a capture-now request asks for (ADR-0016 follow-up). The region is
// normalised to the chosen display: each value in [0, 1], origin top-left.
public enum CaptureMode: String, CaseIterable, Sendable {
    case focusedWindow = "focused-window"
    case region
    case display
}

public struct CaptureRegion: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

// The one pending capture-now request, carried only inside `control` on an
// acknowledgement. It names what to capture and nothing else. `expiresAt` is its
// deadline; `selection` binds a region to the screen selection it was drawn against
// (present exactly when the mode is region).
public struct CaptureRequest: Equatable, Sendable {
    public let requestId: String
    public let mode: CaptureMode
    public let region: CaptureRegion?
    public let selection: String?
    public let expiresAt: String

    public init(
        requestId: String, mode: CaptureMode, region: CaptureRegion? = nil, selection: String? = nil,
        expiresAt: String
    ) {
        self.requestId = requestId
        self.mode = mode
        self.region = region
        self.selection = selection
        self.expiresAt = expiresAt
    }
}

public struct ControlStatus: Equatable, Sendable {
    public let state: ControlState
    public let credentialExpiresAt: String
    public let capture: CaptureRequest?

    public init(state: ControlState, credentialExpiresAt: String, capture: CaptureRequest? = nil) {
        self.state = state
        self.credentialExpiresAt = credentialExpiresAt
        self.capture = capture
    }
}

public struct AcceptedAck: Equatable, Sendable {
    public let sourceId: String
    public let eventId: String
    public let control: ControlStatus

    public init(sourceId: String, eventId: String, control: ControlStatus) {
        self.sourceId = sourceId
        self.eventId = eventId
        self.control = control
    }
}

public struct AckIssue: Equatable, Sendable {
    public let path: [PathPart]
    public let code: String

    public init(path: [PathPart], code: String) {
        self.path = path
        self.code = code
    }
}

public enum Acknowledgement: Equatable, Sendable {
    case accepted(AcceptedAck)
    case duplicate(original: AcceptedAck)
    case refused(code: RefusalCode, control: ControlStatus?, issues: [AckIssue]?)

    // The control state carried by any acknowledgement; absent only when the
    // credential itself was refused (nothing is disclosed to it).
    public var control: ControlStatus? {
        switch self {
        case .accepted(let ack): return ack.control
        case .duplicate(let original): return original.control
        case .refused(_, let control, _): return control
        }
    }
}

// MARK: - Validator

public enum WireValidator {
    // Mirrors isIdentityFieldName in contracts observation.ts, including the
    // normalisation (lower case, no hyphen or underscore).
    private static let identityFieldNames: Set<String> = [
        "tenant", "tenantid", "user", "userid", "actor", "actorid", "session", "sessionid",
        "owner", "ownerid", "account", "accountid", "member", "memberid", "organization",
        "organizationid", "org", "orgid", "credential", "token", "authorization",
    ]

    public static func isIdentityFieldName(_ key: String) -> Bool {
        let normalized = key.lowercased().replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "_", with: "")
        return identityFieldNames.contains(normalized)
    }

    // Validates one serialized envelope: the size limit comes first so an
    // oversize body is refused before it is parsed.
    public static func validateIngest(data: Data) -> WireResult<IngestMessage> {
        if data.count > ActiveSessionLimits.maxEnvelopeBytes {
            return .failure([WireIssue(path: [], code: .tooLarge)])
        }
        guard let json = JSONValue.parse(data) else {
            return .failure([WireIssue(path: [], code: .invalidType)])
        }
        return validateIngest(json)
    }

    public static func validateIngest(_ json: JSONValue) -> WireResult<IngestMessage> {
        guard case .object(let fields) = json else {
            return .failure([WireIssue(path: [], code: .invalidType)])
        }
        // [GUARD] Identity smuggled anywhere is refused first, with its path.
        var identity: [WireIssue] = []
        scanIdentity(json, path: [], into: &identity, depth: 0)
        if !identity.isEmpty { return .failure(identity) }

        let reader = Reader()
        if fields["version"] != .number(Double(wireVersion)) {
            reader.issues.append(WireIssue(path: [.key("version")], code: .unsupportedVersion))
        }
        let object = ObjectReader(fields, path: [], reader: reader)
        object.markUsed("version")

        var parsed: IngestMessage?
        switch fields["kind"] {
        case .string("transcript.final"), .string("screen.snapshot"),
            .string("source.disconnected"), .string("capture.gap"):
            parsed = parseObservation(object).map(IngestMessage.observation)
        case .string("heartbeat"):
            object.markUsed("kind")
            parsed = parseHeartbeat(object).map(IngestMessage.heartbeat)
        case .string("capability.report"):
            object.markUsed("kind")
            parsed = parseCapabilityReport(object).map(IngestMessage.capabilityReport)
        case .string("capture.failure"):
            object.markUsed("kind")
            parsed = parseCaptureFailure(object).map(IngestMessage.captureFailure)
        case .string("voice.activity"):
            object.markUsed("kind")
            parsed = parseVoiceActivity(object).map(IngestMessage.voiceActivity)
        default:
            // An unknown or missing kind stops here: its other fields cannot be judged.
            reader.issues.append(WireIssue(path: [.key("kind")], code: .unknownKind))
            return .failure(reader.issues)
        }
        if let parsed, reader.issues.isEmpty { return .ok(parsed) }
        return .failure(reader.issues)
    }

    public static func validateAcknowledgement(data: Data) -> WireResult<Acknowledgement> {
        guard let json = JSONValue.parse(data) else {
            return .failure([WireIssue(path: [], code: .invalidType)])
        }
        return validateAcknowledgement(json)
    }

    public static func validateAcknowledgement(_ json: JSONValue) -> WireResult<Acknowledgement> {
        guard case .object(let fields) = json else {
            return .failure([WireIssue(path: [], code: .invalidType)])
        }
        let reader = Reader()
        if fields["version"] != .number(Double(wireVersion)) {
            reader.issues.append(WireIssue(path: [.key("version")], code: .unsupportedVersion))
        }
        let object = ObjectReader(fields, path: [], reader: reader)
        object.markUsed("version")
        let parsed = parseAcknowledgement(object)
        if let parsed, reader.issues.isEmpty { return .ok(parsed) }
        return .failure(reader.issues)
    }

    // MARK: identity scan

    private static let maxScanDepth = 8

    private static func scanIdentity(
        _ node: JSONValue, path: [PathPart], into issues: inout [WireIssue], depth: Int
    ) {
        if depth > maxScanDepth { return }
        switch node {
        case .array(let items):
            for (index, item) in items.enumerated() {
                scanIdentity(item, path: path + [.index(index)], into: &issues, depth: depth + 1)
            }
        case .object(let fields):
            for key in fields.keys.sorted() {
                if isIdentityFieldName(key) {
                    issues.append(WireIssue(path: path + [.key(key)], code: .identityFieldForbidden))
                } else if let child = fields[key] {
                    scanIdentity(child, path: path + [.key(key)], into: &issues, depth: depth + 1)
                }
            }
        default: return
        }
    }

    // MARK: ingest parsers

    private static func parseEnvelope(_ object: ObjectReader) -> Envelope? {
        let sourceId = object.id("sourceId")
        let eventId = object.id("eventId")
        let occurredAt = object.timestamp("occurredAt")
        let sequence = object.int("sequence", min: 0)
        guard let sourceId, let eventId, let occurredAt, let sequence else { return nil }
        return Envelope(sourceId: sourceId, eventId: eventId, occurredAt: occurredAt, sequence: sequence)
    }

    private static func parseObservation(_ object: ObjectReader) -> Observation? {
        let envelope = parseEnvelope(object)
        let kind = object.enumeration("kind", ObservationKind.self)
        let content = object.object("content")
        guard let kind, let content else {
            object.finish()
            return nil
        }
        let body: ObservationBody?
        switch kind {
        case .transcriptFinal: body = parseTranscript(content)
        case .screenSnapshot: body = parseScreen(content)
        case .sourceDisconnected: body = parseDisconnect(content)
        case .captureGap: body = parseGap(content)
        }
        object.finish()
        guard let envelope, let body else { return nil }
        return Observation(envelope: envelope, body: body)
    }

    private enum ObservationKind: String {
        case transcriptFinal = "transcript.final"
        case screenSnapshot = "screen.snapshot"
        case sourceDisconnected = "source.disconnected"
        case captureGap = "capture.gap"
    }

    private static func parseTranscript(_ content: ObjectReader) -> ObservationBody? {
        let before = content.reader.issues.count
        let speaker = content.string(
            "speaker", min: 1, max: ActiveSessionLimits.maxSpeakerLabelChars, pattern: Patterns.speaker)
        let source = content.optionalEnumeration("source", TranscriptSource.self)
        let text = content.string("text", min: 1, max: ActiveSessionLimits.maxTranscriptTextChars)
        let startMs = content.int("startMs", min: 0)
        let endMs = content.int("endMs", min: 0)
        let supersedes = content.optionalId("supersedes")
        content.finish()
        guard let speaker, let text, let startMs, let endMs, content.reader.issues.count == before
        else { return nil }
        // [GUARD] The contract's refinement runs only on an otherwise valid object.
        if endMs < startMs {
            content.reader.issues.append(WireIssue(path: content.path + [.key("endMs")], code: .invalidValue))
            return nil
        }
        return .transcriptFinal(
            TranscriptContent(
                speaker: speaker, source: source, text: text, startMs: startMs, endMs: endMs,
                supersedes: supersedes))
    }

    private static func parseScreen(_ content: ObjectReader) -> ObservationBody? {
        let payloadRef = content.id("payloadRef")
        let mediaType = content.enumeration("mediaType", ScreenMediaType.self)
        let byteLength = content.int("byteLength", min: 1, max: ActiveSessionLimits.maxScreenshotBytes)
        let windowLabel = content.string("windowLabel", min: 0, max: ActiveSessionLimits.maxWindowLabelChars)
        let before = content.reader.issues.count
        let requestId = content.optionalId("requestId")
        content.finish()
        guard let payloadRef, let mediaType, let byteLength, let windowLabel,
            content.reader.issues.count == before
        else { return nil }
        return .screenSnapshot(
            ScreenContent(
                payloadRef: payloadRef, mediaType: mediaType, byteLength: byteLength,
                windowLabel: windowLabel, requestId: requestId))
    }

    private static func parseDisconnect(_ content: ObjectReader) -> ObservationBody? {
        let source = content.enumeration("source", CaptureSource.self)
        let reason = content.enumeration("reason", DisconnectReason.self)
        content.finish()
        guard let source, let reason else { return nil }
        return .sourceDisconnected(source: source, reason: reason)
    }

    private static func parseGap(_ content: ObjectReader) -> ObservationBody? {
        let source = content.enumeration("source", CaptureSource.self)
        let durationMs = content.int("durationMs", min: 0)
        let reason = content.enumeration("reason", GapReason.self)
        content.finish()
        guard let source, let durationMs, let reason else { return nil }
        return .captureGap(source: source, durationMs: durationMs, reason: reason)
    }

    private static func parseHeartbeat(_ object: ObjectReader) -> Heartbeat? {
        let sourceId = object.id("sourceId")
        let sentAt = object.timestamp("sentAt")
        let capturing = object.bool("capturing")
        object.finish()
        guard let sourceId, let sentAt, let capturing else { return nil }
        return Heartbeat(sourceId: sourceId, sentAt: sentAt, capturing: capturing)
    }

    private static func parseCaptureFailure(_ object: ObjectReader) -> CaptureFailure? {
        let sourceId = object.id("sourceId")
        let sentAt = object.timestamp("sentAt")
        let requestId = object.id("requestId")
        let code = object.enumeration("code", CaptureFailureCode.self)
        object.finish()
        guard let sourceId, let sentAt, let requestId, let code else { return nil }
        return CaptureFailure(sourceId: sourceId, sentAt: sentAt, requestId: requestId, code: code)
    }

    private static func parseVoiceActivity(_ object: ObjectReader) -> VoiceActivity? {
        let sourceId = object.id("sourceId")
        let sentAt = object.timestamp("sentAt")
        let source = object.enumeration("source", TranscriptSource.self)
        let speaking = object.bool("speaking")
        object.finish()
        guard let sourceId, let sentAt, let source, let speaking else { return nil }
        return VoiceActivity(sourceId: sourceId, sentAt: sentAt, source: source, speaking: speaking)
    }

    private static func parseCapabilityReport(_ object: ObjectReader) -> CapabilityReport? {
        let sourceId = object.id("sourceId")
        let sentAt = object.timestamp("sentAt")
        var speech: SpeechCapabilityReport?
        if let speechObject = object.object("speech") {
            let locale = speechObject.string("locale", min: 1, max: 35, pattern: Patterns.locale)
            let onDevice = speechObject.bool("onDeviceAvailable")
            let recognizer = speechObject.bool("recognizerAvailable")
            let authorization = speechObject.enumeration("authorizationStatus", SpeechAuthorization.self)
            speechObject.finish()
            if let locale, let onDevice, let recognizer, let authorization {
                speech = SpeechCapabilityReport(
                    locale: locale, onDeviceAvailable: onDevice, recognizerAvailable: recognizer,
                    authorizationStatus: authorization)
            }
        }
        var permissions: (PermissionState, PermissionState)?
        if let permissionObject = object.object("permissions") {
            let microphone = permissionObject.enumeration("microphone", PermissionState.self)
            let screen = permissionObject.enumeration("screen", PermissionState.self)
            permissionObject.finish()
            if let microphone, let screen { permissions = (microphone, screen) }
        }
        object.finish()
        guard let sourceId, let sentAt, let speech, let permissions else { return nil }
        return CapabilityReport(
            sourceId: sourceId, sentAt: sentAt, speech: speech, microphone: permissions.0,
            screen: permissions.1)
    }

    // MARK: acknowledgement parsers

    private static func parseControl(_ object: ObjectReader?) -> ControlStatus? {
        guard let object else { return nil }
        let state = object.enumeration("state", ControlState.self)
        let expires = object.timestamp("credentialExpiresAt")
        let before = object.reader.issues.count
        let capture = object.present("capture") ? parseCapture(object.object("capture")) : nil
        object.finish()
        guard let state, let expires, object.reader.issues.count == before else { return nil }
        return ControlStatus(state: state, credentialExpiresAt: expires, capture: capture)
    }

    // [GUARD] Mirrors captureRequestSchema: a region exactly when the mode is
    // region, each value in [0, 1], positive size, and inside the display.
    private static func parseCapture(_ object: ObjectReader?) -> CaptureRequest? {
        guard let object else { return nil }
        let requestId = object.id("requestId")
        let mode = object.enumeration("mode", CaptureMode.self)
        let selection = object.present("selection") ? object.id("selection") : nil
        let expiresAt = object.timestamp("expiresAt")
        var region: CaptureRegion?
        if object.present("region"), let regionObject = object.object("region") {
            let x = regionObject.number("x", min: 0, max: 1)
            let y = regionObject.number("y", min: 0, max: 1)
            let width = regionObject.number("width", min: 0, max: 1, exclusiveMin: true)
            let height = regionObject.number("height", min: 0, max: 1, exclusiveMin: true)
            regionObject.finish()
            if let x, let y, let width, let height {
                if x + width <= 1, y + height <= 1 {
                    region = CaptureRegion(x: x, y: y, width: width, height: height)
                } else {
                    object.reader.issues.append(
                        WireIssue(path: object.path + [.key("region")], code: .invalidValue))
                }
            }
        }
        object.finish()
        guard let requestId, let mode, let expiresAt else { return nil }
        if (mode == .region) != object.present("region") {
            object.reader.issues.append(
                WireIssue(path: object.path + [.key("region")], code: .invalidValue))
            return nil
        }
        if (mode == .region) != object.present("selection") {
            object.reader.issues.append(
                WireIssue(path: object.path + [.key("selection")], code: .invalidValue))
            return nil
        }
        if mode == .region, region == nil || selection == nil { return nil }
        return CaptureRequest(
            requestId: requestId, mode: mode, region: region, selection: selection, expiresAt: expiresAt)
    }

    private static func parseAccepted(_ object: ObjectReader) -> AcceptedAck? {
        // A nested acknowledgement (the original of a duplicate) carries its own version.
        if !object.path.isEmpty, object.fields["version"] != .number(Double(wireVersion)) {
            object.reader.issues.append(
                WireIssue(path: object.path + [.key("version")], code: .unsupportedVersion))
        }
        object.markUsed("version")
        let status = object.literal("status", "accepted")
        let sourceId = object.id("sourceId")
        let eventId = object.id("eventId")
        let control = parseControl(object.object("control"))
        object.finish()
        guard status, let sourceId, let eventId, let control else { return nil }
        return AcceptedAck(sourceId: sourceId, eventId: eventId, control: control)
    }

    private static func parseAcknowledgement(_ object: ObjectReader) -> Acknowledgement? {
        guard case .string(let status) = object.fields["status"] else {
            object.reader.issues.append(WireIssue(path: object.path + [.key("status")], code: .invalidType))
            return nil
        }
        switch status {
        case "accepted":
            return parseAccepted(object).map(Acknowledgement.accepted)
        case "duplicate":
            let status = object.literal("status", "duplicate")
            let original = object.object("original").flatMap(parseAccepted)
            object.finish()
            guard status, let original else { return nil }
            return .duplicate(original: original)
        case "refused":
            let status = object.literal("status", "refused")
            let code = object.enumeration("code", RefusalCode.self)
            let control = parseControl(object.optionalObject("control"))
            var issues: [AckIssue]?
            if object.present("issues") {
                issues = parseAckIssues(
                    object.optionalArray("issues", max: 20) ?? [], path: object.path + [.key("issues")],
                    reader: object.reader)
            }
            object.finish()
            guard status, let code else { return nil }
            return .refused(code: code, control: control, issues: issues)
        default:
            object.reader.issues.append(WireIssue(path: object.path + [.key("status")], code: .invalidValue))
            return nil
        }
    }

    private static func parseAckIssues(_ items: [JSONValue], path: [PathPart], reader: Reader) -> [AckIssue]? {
        var result: [AckIssue] = []
        var valid = true
        for (index, item) in items.enumerated() {
            let itemPath = path + [.index(index)]
            guard case .object(let fields) = item else {
                reader.issues.append(WireIssue(path: itemPath, code: .invalidType))
                valid = false
                continue
            }
            let entry = ObjectReader(fields, path: itemPath, reader: reader)
            let code = entry.string("code", min: 0, max: Int.max)
            var parts: [PathPart] = []
            if let pathArray = entry.optionalArray("path", max: Int.max) {
                for part in pathArray {
                    switch part {
                    case .string(let key): parts.append(.key(key))
                    case .number(let number) where number == number.rounded(): parts.append(.index(Int(number)))
                    default:
                        reader.issues.append(WireIssue(path: itemPath + [.key("path")], code: .invalidType))
                        valid = false
                    }
                }
            } else {
                entry.requireArrayFailure("path")
            }
            entry.finish()
            if let code { result.append(AckIssue(path: parts, code: code)) } else { valid = false }
        }
        return valid ? result : nil
    }
}

// MARK: - Reader plumbing

private enum Patterns {
    // [DOMAIN] Same expressions as the generated JSON Schema; \d is spelled
    // [0-9] so ICU does not accept non-ASCII digits.
    static let id = compile("^[A-Za-z0-9._:-]+$")
    static let speaker = compile("^[A-Za-z0-9 ._-]+$")
    static let locale = compile("^[A-Za-z0-9_-]+$")
    static let timestamp = compile(
        "^(?:(?:[0-9]{2}[2468][048]|[0-9]{2}[13579][26]|[0-9]{2}0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?(?:Z|([+-](?:[01][0-9]|2[0-3]):[0-5][0-9])))$"
    )

    private static func compile(_ pattern: String) -> NSRegularExpression {
        // A literal pattern above; failing here is a programming error caught by the first test run.
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern)
    }
}

final class Reader {
    var issues: [WireIssue] = []
}

// Reads typed fields from one JSON object, recording an issue (path and code,
// never the value) for each violation, and refusing unknown fields at finish().
final class ObjectReader {
    let fields: [String: JSONValue]
    let path: [PathPart]
    let reader: Reader
    private var used: Set<String> = []

    init(_ fields: [String: JSONValue], path: [PathPart], reader: Reader) {
        self.fields = fields
        self.path = path
        self.reader = reader
    }

    func markUsed(_ key: String) { used.insert(key) }
    func present(_ key: String) -> Bool { fields[key] != nil }

    private func fail(_ key: String, _ code: IssueCode) {
        reader.issues.append(WireIssue(path: path + [.key(key)], code: code))
    }

    func string(_ key: String, min: Int, max: Int, pattern: NSRegularExpression? = nil) -> String? {
        used.insert(key)
        guard case .string(let value) = fields[key] else {
            fail(key, .invalidType)
            return nil
        }
        // Lengths count UTF-16 units, like the JavaScript contract's .length.
        let length = value.utf16.count
        var valid = true
        if length < min { fail(key, .tooSmall); valid = false }
        if length > max { fail(key, .tooLarge); valid = false }
        if let pattern,
            pattern.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) == nil
        {
            fail(key, .invalidFormat)
            valid = false
        }
        return valid ? value : nil
    }

    func id(_ key: String) -> String? { string(key, min: 1, max: 128, pattern: Patterns.id) }

    // Absent is fine; present but invalid records an issue and returns nil.
    func optionalId(_ key: String) -> String? {
        fields[key] == nil ? nil : id(key)
    }

    func timestamp(_ key: String) -> String? {
        used.insert(key)
        guard case .string(let value) = fields[key] else {
            fail(key, .invalidType)
            return nil
        }
        if Patterns.timestamp.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) == nil {
            fail(key, .invalidFormat)
            return nil
        }
        return value
    }

    func int(_ key: String, min: Int, max: Int = 9_007_199_254_740_991) -> Int? {
        used.insert(key)
        guard case .number(let value) = fields[key], value.isFinite, value == value.rounded() else {
            fail(key, .invalidType)
            return nil
        }
        if value < Double(min) { fail(key, .tooSmall); return nil }
        if value > Double(max) { fail(key, .tooLarge); return nil }
        return Int(value)
    }

    // A finite number within [min, max] (above min when exclusiveMin).
    func number(_ key: String, min: Double, max: Double, exclusiveMin: Bool = false) -> Double? {
        used.insert(key)
        guard case .number(let value) = fields[key], value.isFinite else {
            fail(key, .invalidType)
            return nil
        }
        if value < min || (exclusiveMin && value <= min) { fail(key, .tooSmall); return nil }
        if value > max { fail(key, .tooLarge); return nil }
        return value
    }

    func bool(_ key: String) -> Bool? {
        used.insert(key)
        guard case .bool(let value) = fields[key] else {
            fail(key, .invalidType)
            return nil
        }
        return value
    }

    func literal(_ key: String, _ expected: String) -> Bool {
        used.insert(key)
        guard case .string(let value) = fields[key] else {
            fail(key, .invalidType)
            return false
        }
        if value != expected { fail(key, .invalidValue); return false }
        return true
    }

    func enumeration<E: RawRepresentable<String>>(_ key: String, _: E.Type) -> E? {
        used.insert(key)
        guard case .string(let value) = fields[key] else {
            fail(key, .invalidType)
            return nil
        }
        guard let parsed = E(rawValue: value) else {
            fail(key, .invalidValue)
            return nil
        }
        return parsed
    }

    func optionalEnumeration<E: RawRepresentable<String>>(_ key: String, _ type: E.Type) -> E? {
        fields[key] == nil ? nil : enumeration(key, type)
    }

    func object(_ key: String) -> ObjectReader? {
        used.insert(key)
        guard case .object(let value) = fields[key] else {
            fail(key, .invalidType)
            return nil
        }
        return ObjectReader(value, path: path + [.key(key)], reader: reader)
    }

    func optionalObject(_ key: String) -> ObjectReader? {
        fields[key] == nil ? nil : object(key)
    }

    func optionalArray(_ key: String, max: Int) -> [JSONValue]? {
        used.insert(key)
        guard let value = fields[key] else { return nil }
        guard case .array(let items) = value else {
            fail(key, .invalidType)
            return nil
        }
        if items.count > max { fail(key, .tooLarge) }
        return items
    }

    func requireArrayFailure(_ key: String) {
        if fields[key] == nil { fail(key, .invalidType) }
    }

    // [GUARD] One unknown_field issue per object, whatever the number of keys.
    func finish() {
        if !Set(fields.keys).subtracting(used).isEmpty {
            reader.issues.append(WireIssue(path: path, code: .unknownField))
        }
    }
}
