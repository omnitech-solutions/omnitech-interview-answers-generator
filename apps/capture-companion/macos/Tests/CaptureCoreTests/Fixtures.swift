import Foundation
import CaptureCore

// Synthetic test doubles. Nothing here touches the network, the disk or a
// framework; the credential is a made-up value of the right shape.
let testCredential = "asc_" + String(repeating: "A", count: 43)

final class FakeClock: WallClock {
    var date = Date(timeIntervalSince1970: 1_790_000_000)
    func now() -> Date { date }
    func advance(_ seconds: Double) { date = date.addingTimeInterval(seconds) }
}

final class FakeCredentials: CredentialStore {
    var stored: String? = testCredential
    func load() throws -> String? { stored }
    func save(_ credential: String) throws { stored = credential }
    func delete() throws { stored = nil }
}

final class FakeSources: SourceControl {
    var started: [CaptureSource] = []
    var stopped: [CaptureSource] = []
    func start(_ source: CaptureSource) { started.append(source) }
    func stop(_ source: CaptureSource) { stopped.append(source) }
}

final class FakeMarker: StopMarkerStore {
    var persistedAt: Date?
    var fails = false
    func persistStoppedLocally(at time: Date) throws {
        if fails { throw TestError("disk unavailable") }
        persistedAt = time
    }
}

actor ScriptedTransport: Transport {
    typealias Responder = @Sendable (OutgoingRequest) -> TransportResult
    private(set) var requests: [OutgoingRequest] = []
    private var responder: Responder

    init(_ responder: @escaping Responder) { self.responder = responder }

    func set(_ responder: @escaping Responder) { self.responder = responder }
    func send(_ request: OutgoingRequest) async -> TransportResult {
        requests.append(request)
        return responder(request)
    }
    func requestCount() -> Int { requests.count }
}

// The envelope JSON of a request, JSON or multipart.
func envelopeJSON(of request: OutgoingRequest) -> JSONValue? {
    let text = String(decoding: request.body, as: UTF8.self)
    if request.headers["Content-Type"]?.hasPrefix("multipart/form-data") == true {
        guard let start = text.range(of: "name=\"envelope\"\r\nContent-Type: application/json\r\n\r\n"),
            let end = text.range(of: "\r\n--", range: start.upperBound..<text.endIndex)
        else { return nil }
        return JSONValue.parse(Data(text[start.upperBound..<end.lowerBound].utf8))
    }
    return JSONValue.parse(request.body)
}

func stringField(_ json: JSONValue?, _ key: String) -> String? {
    if case .object(let fields)? = json, case .string(let value)? = fields[key] { return value }
    return nil
}

func controlJSON(_ state: String) -> String {
    #"{"state":"\#(state)","credentialExpiresAt":"2026-10-03T12:00:00.000Z"}"#
}

// An accepted acknowledgement echoing the request's own ids.
func acceptedResult(for request: OutgoingRequest, state: String = "active") -> TransportResult {
    let envelope = envelopeJSON(of: request)
    let sourceId = stringField(envelope, "sourceId") ?? "x"
    var eventId = stringField(envelope, "eventId")
    if eventId == nil { eventId = stringField(envelope, "kind") == "heartbeat" ? "heartbeat" : "capability" }
    let body =
        #"{"version":1,"status":"accepted","sourceId":"\#(sourceId)","eventId":"\#(eventId ?? "x")","control":\#(controlJSON(state))}"#
    return .response(status: 200, body: Data(body.utf8), retryAfterSeconds: nil)
}

func refusedResult(
    _ code: String, state: String? = nil, issuesJSON: String? = nil, status: Int = 409, retryAfter: Double? = nil
) -> TransportResult {
    var body = #"{"version":1,"status":"refused","code":"\#(code)""#
    if let state { body += #","control":\#(controlJSON(state))"# }
    if let issuesJSON { body += #","issues":\#(issuesJSON)"# }
    body += "}"
    return .response(status: status, body: Data(body.utf8), retryAfterSeconds: retryAfter)
}

struct SessionHarness {
    let session: CompanionSession
    let clock: FakeClock
    let credentials: FakeCredentials
    let sources: FakeSources
    let marker: FakeMarker
    let transport: ScriptedTransport
    let buffers: [AudioRingBuffer]
}

@MainActor
func makeSession(
    selection: Set<CaptureSource> = [.microphone, .screen], capacity: Int = 500,
    responder: @escaping ScriptedTransport.Responder = { acceptedResult(for: $0) },
    screenSelection: String? = "disp-1.1", focusPid: Int32? = 4242
) -> SessionHarness {
    let clock = FakeClock()
    let credentials = FakeCredentials()
    let sources = FakeSources()
    let marker = FakeMarker()
    let transport = ScriptedTransport(responder)
    let buffers = [AudioRingBuffer(maxSeconds: 5)]
    let endpoint = Endpoint(studioAddress: "https://studio.example.test", tenantSlug: "acme")!
    let session = CompanionSession(
        selection: selection, runId: "r1", endpoint: endpoint, credentials: credentials,
        transport: transport, clock: clock, sources: sources, marker: marker, buffers: buffers,
        backoff: Backoff(random: { 0 }), outboxCapacity: capacity,
        screenSelection: { screenSelection }, focusSampler: { FocusSample(frontmostPid: focusPid) })
    return SessionHarness(
        session: session, clock: clock, credentials: credentials, sources: sources, marker: marker,
        transport: transport, buffers: buffers)
}

let readyCapability = CapabilityOutcome(
    report: CapabilityReport(
        sourceId: "companion-r1", sentAt: "2026-10-03T10:00:00.000Z",
        speech: SpeechCapabilityReport(
            locale: "en_GB", onDeviceAvailable: true, recognizerAvailable: true, authorizationStatus: .authorized),
        microphone: .granted, screen: .granted),
    failure: nil)
