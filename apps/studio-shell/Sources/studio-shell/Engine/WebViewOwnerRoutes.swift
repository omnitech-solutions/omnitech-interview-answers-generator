import Foundation
import StudioShellCore
import WebKit

// [SAFETY] The engine's owner routes, called from INSIDE the signed-in web view
// so Studio sees the person's own session and the shell never holds their
// cookie (StudioWebFetch: a private content world, so the credential comes back
// to native code as a string and the page's own scripts cannot see or forge it).
// It is stored in the Keychain by the engine and never put in a URL, a log or a
// reply to the page.
@MainActor
public final class WebViewOwnerRoutes: OwnerRoutes {
    private let webViewProvider: () -> WKWebView?
    private let locationProvider: () -> StudioLocation?
    private var location: StudioLocation? { locationProvider() }

    public init(webView: @escaping () -> WKWebView?, location: @escaping () -> StudioLocation?) {
        webViewProvider = webView
        locationProvider = location
    }

    public func issueCredential(sessionId: String) async -> Result<IssuedCredential, OwnerRouteFailure> {
        guard let location, StudioLocation.isSessionId(sessionId) else { return .failure(.gone) }
        guard let answer = await request(path: "\(location.sessionsPath)/\(sessionId)/credential", method: "POST")
        else {
            return .failure(.unreachable)
        }
        switch answer.status {
        case 200:
            guard let text = answer.text, let credential = IssuedCredential.parse(text) else {
                return .failure(.unreachable)
            }
            return .success(credential)
        case 401, 403: return .failure(.signedOut)
        case 404, 409, 410: return .failure(.gone)
        default: return .failure(.unreachable)
        }
    }

    public func revokeCredential(sessionId: String) async -> Bool {
        guard let location, StudioLocation.isSessionId(sessionId) else { return false }
        let answer = await request(path: "\(location.sessionsPath)/\(sessionId)/credential", method: "DELETE")
        return answer.map { (200..<300).contains($0.status) } ?? false
    }

    private func request(path: String, method: String) async -> StudioAnswer? {
        await StudioWebFetch.run(in: webViewProvider(), at: location, path: path, method: method)
    }
}
