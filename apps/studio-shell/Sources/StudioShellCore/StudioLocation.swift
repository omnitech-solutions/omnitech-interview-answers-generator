import CaptureCore
import Foundation

// [DOMAIN] Where Studio is: an origin and a workspace slug. The shell loads one
// route from it, the overlay route every host loads (ADR-0017), and keeps every
// other address out of the web view.
public struct StudioLocation: Equatable, Sendable {
    public static let defaultAddress = "http://127.0.0.1:3000"
    public static let productId = "interview"

    public let endpoint: Endpoint

    // [GUARD] The address is an origin only: https, or http for a loopback
    // development Studio, with no user info, path, query or fragment. An empty
    // field means the default. The same rules as the companion's pairing.
    public init?(address: String, tenantSlug: String) {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let endpoint = Endpoint(
                studioAddress: trimmed.isEmpty ? Self.defaultAddress : trimmed, tenantSlug: tenantSlug)
        else { return nil }
        self.endpoint = endpoint
    }

    public var origin: URL { endpoint.baseURL }
    public var tenantSlug: String { endpoint.tenantSlug }

    private var productBase: String { "/t/\(tenantSlug)/p/\(Self.productId)" }

    // /t/:tenant/p/interview/live/overlay?host=native[&panel=<name>][&handsfree=1][&session=<id>]
    // `window` selects the page the route draws: `single` for the compact window,
    // `settings` for Settings; none is the route's own default.
    public func overlayURL(sessionId: String? = nil, window: WindowKind? = nil, handsFree: Bool = false) -> URL {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = "\(productBase)/live/overlay"
        var query = [URLQueryItem(name: "host", value: "native")]
        if let window { query.append(URLQueryItem(name: "panel", value: window.queryName)) }
        // The minified shell is a hands-free host: Studio defaults Auto on.
        if handsFree { query.append(URLQueryItem(name: "handsfree", value: "1")) }
        if let sessionId, Self.isSessionId(sessionId) { query.append(URLQueryItem(name: "session", value: sessionId)) }
        components.queryItems = query
        return components.url ?? origin
    }

    // The Studio home, for "Open Studio in browser".
    public var studioURL: URL {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = "\(productBase)/live"
        return components.url ?? origin
    }

    // Public and credential-free: the install manifest doubles as a cheap
    // reachability probe (ADR-0019).
    public var probeURL: URL {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = "\(productBase)/manifest.webmanifest"
        return components.url ?? origin
    }

    // The session API the Studio frontend itself uses; the shell only calls it
    // from inside the web view, with the person's own sign-in.
    public var sessionsPath: String { "/api/interview/t/\(tenantSlug)/sessions" }

    // [SAFETY] Same scheme, host and port as Studio, nothing else: the web view
    // never navigates elsewhere, and the bridge answers only this origin.
    public func isStudio(scheme: String?, host: String?, port: Int?) -> Bool {
        guard let scheme, let host else { return false }
        let own = origin
        let ownPort = own.port ?? (own.scheme == "https" ? 443 : 80)
        let theirPort = port ?? (scheme == "https" ? 443 : 80)
        return scheme.lowercased() == own.scheme?.lowercased() && host.lowercased() == own.host?.lowercased()
            && theirPort == ownPort
    }

    public func isStudio(_ url: URL) -> Bool {
        isStudio(scheme: url.scheme, host: url.host, port: url.port)
    }

    public static func isSessionId(_ text: String) -> Bool {
        UUID(uuidString: text) != nil
    }
}
