import CryptoKit
import Foundation

// [DOMAIN] The native sign-in round trip (ADR-0019 amendment, ADR-0006). Studio's
// own Auth.js sign-in runs in the person's default browser, never in the privileged
// web view; Studio answers with a one-time handoff code on the app's own
// callback scheme; the shell redeems it inside the web view, where Studio sets
// its own session cookie. The code authorises login only. It is not a provider
// token, and the paired capture credential is never involved.

// The two login providers Studio's native sign-in offers (the `start` route
// takes the same names).
public enum SignInProvider: String, CaseIterable, Sendable {
    case google
    case linkedin
}

// What the panel is told about the sign-in: nothing running, the browser opened
// for a provider, or the attempt abandoned at its time limit.
public enum AccountState: Equatable, Sendable {
    case idle
    case waiting(SignInProvider)
    case timedOut

    public var wire: [String: Any] {
        switch self {
        case .idle: ["phase": "idle"]
        case .waiting(let provider): ["phase": "waiting", "provider": provider.rawValue]
        case .timedOut: ["phase": "timed-out"]
        }
    }
}

// What macOS says about one permission. "undetermined": it has not been asked
// yet, so it asks the first time a session needs it.
public enum PermissionState: String, Sendable {
    case granted
    case denied
    case undetermined
}

// Why the sign-in panel was shown, for its first line.
public enum SignInNotice: String, Sendable {
    case expired
    case signedOut = "signed-out"
}

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
    public static func makeState() -> String { randomToken() }

    // [SAFETY] The attempt's secret (RFC 7636 code verifier): 32 random bytes the
    // shell keeps in memory and presents only when it redeems the code. The state
    // travels in browser history and the code through a URL scheme any app can
    // register, so neither alone may redeem anything; only the holder of this can.
    public static func makeVerifier() -> String { randomToken() }

    // What Studio is told when the attempt starts: the unpadded base64url SHA-256
    // of the verifier (S256). It reveals nothing of the verifier.
    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func randomToken() -> String {
        var generator = SystemRandomNumberGenerator()
        return base64URL(Data((0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
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

    // What the default browser opens. Carries only the attempt nonce, the
    // challenge of the shell's secret verifier and, when the person chose one,
    // the provider's name. "Copy link" copies this, so it must hold nothing that
    // can redeem the attempt: the verifier stays in the shell.
    public func nativeSignInStartURL(state: String, challenge: String, provider: SignInProvider? = nil) -> URL {
        var query = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "challenge", value: challenge)]
        if let provider { query.append(URLQueryItem(name: "provider", value: provider.rawValue)) }
        return path("/api/native-auth/start", query)
    }

    // The panel the shell loads while no Studio session exists: Studio's public,
    // read-only sign-in panel (the tenant routes refuse a signed-out visitor).
    // `notice` says why the person is here: an expired session or a sign-out.
    public func signInPanelURL(notice: SignInNotice? = nil) -> URL {
        var query = [URLQueryItem(name: "tenant", value: tenantSlug)]
        if let notice { query.append(URLQueryItem(name: "notice", value: notice.rawValue)) }
        return path("/native/sign-in", query)
    }

    public func isSignInPanel(_ url: URL) -> Bool { isStudio(url) && url.path == "/native/sign-in" }

    // What the web view loads after the callback: the one-time code plus the
    // shell's nonce, its secret verifier and workspace. Studio verifies, consumes
    // it and sets its own session cookie.
    public func nativeSignInRedeemURL(code: String, state: String, verifier: String) -> URL {
        path(
            "/api/native-auth/redeem",
            [
                URLQueryItem(name: "code", value: code), URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "verifier", value: verifier), URLQueryItem(name: "tenant", value: tenantSlug),
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

    private var pending: (state: String, verifier: String, startedAt: Date, provider: SignInProvider?, url: URL)?

    public init() {}

    public func isPending(now: Date) -> Bool {
        guard let pending else { return false }
        return now.timeIntervalSince(pending.startedAt) < NativeSignIn.attemptTimeout
    }

    // The waiting attempt's provider and link, for "Open browser again" and
    // "Copy link"; nil with none live. The link carries only the nonce and the
    // challenge, never the verifier.
    public func waiting(now: Date) -> (provider: SignInProvider?, url: URL)? {
        guard let pending, isPending(now: now) else { return nil }
        return (pending.provider, pending.url)
    }

    // Starts an attempt and returns the URL to open, or nil while an earlier
    // attempt is still live (a page cannot stack prompts).
    public mutating func begin(
        at location: StudioLocation, now: Date, provider: SignInProvider? = nil,
        makeState: () -> String = NativeSignIn.makeState,
        makeVerifier: () -> String = NativeSignIn.makeVerifier
    ) -> URL? {
        guard !isPending(now: now) else { return nil }
        let state = makeState()
        let verifier = makeVerifier()
        let url = location.nativeSignInStartURL(
            state: state, challenge: NativeSignIn.challenge(for: verifier), provider: provider)
        pending = (state, verifier, now, provider, url)
        return url
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
        return .success(location.nativeSignInRedeemURL(code: code, state: current.state, verifier: current.verifier))
    }

    // The person closed the sheet, the session errored, or the shell rebound or
    // disconnected.
    public mutating func cancel() { pending = nil }
}

// [DOMAIN] What the shell shows when Studio's own pages cannot be loaded at all
// (the server is down) and nothing of Studio's is on screen: without it the window
// would be empty and, on the shell's clear window, see-through. Studio's sign-in
// panel is a page of Studio's, so it cannot show this. It is a plain opaque screen
// with one button; the button is a link to a start address the shell recognises,
// so it needs no script and no bridge, and a page that is not this screen cannot
// use it. The shell answers the link by loading Studio's sign-in panel again.
public enum SignedOutScreen {
    public static let startURL = URL(string: "omnitech-studio://signin-start")!

    // [SAFETY] Exactly the start address: no user info, path, query or fragment.
    public static func isStart(_ url: URL) -> Bool {
        url.scheme?.lowercased() == NativeSignIn.callbackScheme
            && url.host?.lowercased() == "signin-start"
            && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil
            && (url.path.isEmpty || url.path == "/")
    }

    // The second button: change the connection (the saved address may be what is
    // wrong, and the screen itself has nowhere to type one).
    public static let changeConnectionURL = URL(string: "omnitech-studio://change-connection")!

    // [SAFETY] Exactly the change-connection address: no user info, path, query or fragment.
    public static func isChangeConnection(_ url: URL) -> Bool {
        url.scheme?.lowercased() == NativeSignIn.callbackScheme
            && url.host?.lowercased() == "change-connection"
            && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil
            && (url.path.isEmpty || url.path == "/")
    }

    // Text only: the address is escaped, so it can never become markup.
    private static func escaped(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    // Local and self-contained: loaded as a string, no network, no script. It names
    // the address that did not answer, so a stale one is visible, and it offers a
    // retry and a way to change the connection.
    public static func html(address: String) -> String {
        """
        <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <title>Interview Studio</title>
        <style>
        html,body{margin:0;height:100%;background:#151517;color:#f2f2f2;font:13px -apple-system,system-ui,sans-serif}
        main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
        h1{font-size:16px;margin:0}
        p{margin:0;color:#b5b5b5;line-height:1.4}
        code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e0e0e0}
        .row{display:flex;gap:8px;margin-top:6px}
        a{display:inline-block;padding:8px 16px;border-radius:9px;background:#2f6fe4;color:#fff;text-decoration:none;font-weight:600}
        a.quiet{background:#2a2a2e;color:#e0e0e0}
        </style>
        <main>
        <h1>Can’t reach Studio</h1>
        <p>Interview Studio tried <code>\(escaped(address))</code> and got no answer.<br>Check that Studio is running there, or change the connection.</p>
        <div class="row">
        <a href="\(startURL.absoluteString)">Try again</a>
        <a class="quiet" href="\(changeConnectionURL.absoluteString)">Change connection…</a>
        </div>
        </main>
        """
    }
}
