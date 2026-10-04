import Foundation

// [DOMAIN] The native sign-in round trip (ADR-0019 amendment, ADR-0006). Studio's
// own Auth.js sign-in runs in a system web-auth session, never in the privileged
// web view; Studio answers with a one-time handoff code on the app's own
// callback scheme; the shell redeems it inside the web view, where Studio sets
// its own session cookie. The code authorises login only. It is not a provider
// token, and the paired capture credential is never involved.

public enum NativeSignIn {
    // The app bundle's own scheme (bundle-app.sh registers it in Info.plist).
    public static let callbackScheme = "omnitech-studio"
    public static let callbackHost = "signin"
    // An unfinished attempt is abandoned after this long.
    public static let attemptTimeout: TimeInterval = 300

    // Hosts of the login providers Studio's Auth.js can send a person to. The
    // web view never hosts them: a navigation there starts the round trip.
    static let providerHosts: Set<String> = ["accounts.google.com", "www.linkedin.com", "linkedin.com"]

    // [SAFETY] The callback must be exactly scheme://signin?code=<code>: no other
    // parameter, no user info, no fragment, so a session token can never ride in
    // it and a stray URL cannot smuggle anything.
    public static func parseCallback(_ url: URL) -> String? {
        guard url.scheme?.lowercased() == callbackScheme, url.host?.lowercased() == callbackHost,
            url.user == nil, url.password == nil, url.fragment == nil,
            url.path.isEmpty || url.path == "/",
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
            items.count == 1, items[0].name == "code", let code = items[0].value, isCode(code)
        else { return nil }
        return code
    }

    public static func isCode(_ text: String) -> Bool {
        (16...128).contains(text.count) && text.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    // The attempt nonce: 32 random bytes, URL-safe base64 (43 characters).
    public static func makeState() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension StudioLocation {
    // Studio's own sign-in pages: the web view asking for one starts the round
    // trip instead of showing a provider flow inside itself.
    public func isSignInPage(_ url: URL) -> Bool {
        isStudio(url) && (url.path == "/sign-in" || url.path.hasPrefix("/api/auth/signin"))
    }

    // [SAFETY] https only, a known provider host, nothing with user info.
    public func isLoginProvider(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", url.user == nil, let host = url.host?.lowercased() else { return false }
        return NativeSignIn.providerHosts.contains(host)
    }

    // Public: does Studio have a real login provider at all?
    public var signInProvidersURL: URL { path("/api/native-auth/providers") }

    // What the web-auth session opens. Carries only the attempt nonce.
    public func nativeSignInStartURL(state: String) -> URL {
        path("/api/native-auth/start", [URLQueryItem(name: "state", value: state)])
    }

    // What the web view loads after the callback: the one-time code plus the
    // shell's nonce and workspace. Studio verifies, consumes it and sets its
    // own session cookie.
    public func nativeSignInRedeemURL(code: String, state: String) -> URL {
        path(
            "/api/native-auth/redeem",
            [
                URLQueryItem(name: "code", value: code), URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "tenant", value: tenantSlug),
            ])
    }

    private func path(_ path: String, _ query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        return components.url ?? origin
    }
}

// [DOMAIN] One sign-in attempt at a time. Idle until started; pending with the
// nonce until a valid callback, a cancel, or the timeout. A callback is accepted
// only while pending and only once.
public struct SignInAttempt: Sendable {
    public enum Refusal: Error, Equatable, Sendable { case noAttempt, timedOut, malformedCallback }

    private var pending: (state: String, startedAt: Date)?

    public init() {}

    public func isPending(now: Date) -> Bool {
        guard let pending else { return false }
        return now.timeIntervalSince(pending.startedAt) < NativeSignIn.attemptTimeout
    }

    // Starts an attempt and returns the URL to open, or nil while an earlier
    // attempt is still live (a page cannot stack prompts).
    public mutating func begin(
        at location: StudioLocation, now: Date, makeState: () -> String = NativeSignIn.makeState
    ) -> URL? {
        guard !isPending(now: now) else { return nil }
        let state = makeState()
        pending = (state, now)
        return location.nativeSignInStartURL(state: state)
    }

    // Accepts the callback of the pending attempt once and returns the URL the
    // web view should load to redeem it.
    public mutating func receive(
        _ callback: URL, at location: StudioLocation, now: Date
    ) -> Result<URL, Refusal> {
        guard let current = pending else { return .failure(.noAttempt) }
        pending = nil
        guard now.timeIntervalSince(current.startedAt) < NativeSignIn.attemptTimeout else { return .failure(.timedOut) }
        guard let code = NativeSignIn.parseCallback(callback) else { return .failure(.malformedCallback) }
        return .success(location.nativeSignInRedeemURL(code: code, state: current.state))
    }

    // The person closed the sheet, the session errored, or the shell rebound or
    // disconnected.
    public mutating func cancel() { pending = nil }
}
