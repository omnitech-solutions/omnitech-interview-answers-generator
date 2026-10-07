import Foundation

// [SAFETY] The credential reaches the network in exactly one place: an
// `Authorization: Bearer` header built here (rule:credential-storage). No URL
// this file builds ever contains it, and nothing here logs or prints.

public protocol CredentialStore {
    func load() throws -> String?
    func save(_ credential: String) throws
    func delete() throws
}

public protocol WallClock {
    func now() -> Date
}

public struct SystemClock: WallClock {
    public init() {}
    public func now() -> Date { Date() }
}

public enum TimeText {
    // UTC, millisecond precision: matches the wire's timestamp format.
    public static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    public static func parse(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }
}

// Negotiation (ADR-0020): every request declares what this companion understands, in headers
// outside the strict bodies. A Studio that does not know them ignores them and never sends a
// capture request; one that does hands over a request only to a companion that declared it.
public enum Negotiation {
    public static let featuresHeader = "x-companion-features"
    public static let screenHeader = "x-companion-screen"
    public static let captureRequestFeature = "capture-request.v1"
}

public struct OutgoingRequest: Equatable, Sendable {
    public let url: URL
    public let headers: [String: String]
    public let body: Data
}

public enum TransportResult: Sendable {
    // Any HTTP answer. retryAfterSeconds is the Retry-After header, if numeric.
    case response(status: Int, body: Data, retryAfterSeconds: Double?)
    // No answer: offline, DNS, TLS, timeout. Capture continues; the outbox waits.
    case unreachable
}

public protocol Transport: Sendable {
    func send(_ request: OutgoingRequest) async -> TransportResult
}

public struct Endpoint: Equatable, Sendable {
    public let baseURL: URL
    public let tenantSlug: String

    // [GUARD] The Studio address is an origin only: https (http only for a
    // loopback dev Studio), no user info, path, query or fragment, so nothing
    // pasted into it can carry a secret into a URL.
    public init?(studioAddress: String, tenantSlug: String) {
        guard Self.isValidSlug(tenantSlug),
            let components = URLComponents(string: studioAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
            let host = components.host, !host.isEmpty,
            components.user == nil, components.password == nil, components.query == nil,
            components.fragment == nil, components.path.isEmpty || components.path == "/"
        else { return nil }
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard components.scheme == "https" || (components.scheme == "http" && loopback) else { return nil }
        var origin = URLComponents()
        origin.scheme = components.scheme
        origin.host = host
        origin.port = components.port
        guard let url = origin.url else { return nil }
        self.baseURL = url
        self.tenantSlug = tenantSlug
    }

    public static func isValidSlug(_ slug: String) -> Bool {
        slug.range(of: "^[a-z0-9][a-z0-9-]{0,62}$", options: .regularExpression) != nil
    }

    public static func isCredentialShape(_ credential: String) -> Bool {
        credential.range(of: "^asc_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
    }

    public var ingestURL: URL {
        var components = URLComponents()
        components.scheme = baseURL.scheme
        components.host = baseURL.host
        components.port = baseURL.port
        components.path = "/api/interview/t/\(tenantSlug)/sessions/ingest"
        return components.url ?? baseURL
    }

    // JSON for every message except a screenshot, which is multipart with an
    // `envelope` part and a `payload` part. Returns nil for a malformed
    // credential so a bad paste is never put on the wire.
    public func request(
        for message: IngestMessage, payload: Data? = nil, credential: String,
        screenSelection: String? = nil, boundary: String = "asc-" + UUID().uuidString
    ) -> OutgoingRequest? {
        guard Self.isCredentialShape(credential) else { return nil }
        var headers = [
            "Authorization": "Bearer \(credential)",
            Negotiation.featuresHeader: Negotiation.captureRequestFeature,
        ]
        if let screenSelection { headers[Negotiation.screenHeader] = screenSelection }
        let envelope = message.encoded()
        guard case .observation(let observation) = message, case .screenSnapshot(let content) = observation.body,
            let payload
        else {
            headers["Content-Type"] = "application/json"
            return OutgoingRequest(url: ingestURL, headers: headers, body: envelope)
        }
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        append(
            "--\(boundary)\r\nContent-Disposition: form-data; name=\"envelope\"\r\nContent-Type: application/json\r\n\r\n"
        )
        body.append(envelope)
        append(
            "\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"payload\"; filename=\"payload\"\r\nContent-Type: \(content.mediaType.rawValue)\r\n\r\n"
        )
        body.append(payload)
        append("\r\n--\(boundary)--\r\n")
        headers["Content-Type"] = "multipart/form-data; boundary=\(boundary)"
        return OutgoingRequest(url: ingestURL, headers: headers, body: body)
    }
}
