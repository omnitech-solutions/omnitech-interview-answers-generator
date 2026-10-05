import Foundation
import StudioShellCore
import WebKit

// [SAFETY] The engine's owner routes, called from INSIDE the signed-in web view
// so Studio sees the person's own session and the shell never holds their
// cookie. The request runs in a private WKContentWorld: the credential comes
// back to native code as a string and is never visible to, or interceptable by,
// the page's own scripts (a page that replaced fetch could not see this one).
// It is stored in the Keychain by the engine and never put in a URL, a log or a
// reply to the page.
@MainActor
public final class WebViewOwnerRoutes: OwnerRoutes {
    private let webViewProvider: () -> WKWebView?
    private let locationProvider: () -> StudioLocation?
    private var location: StudioLocation? { locationProvider() }
    private let world = WKContentWorld.world(name: "studio-shell-engine")

    public init(webView: @escaping () -> WKWebView?, location: @escaping () -> StudioLocation?) {
        webViewProvider = webView
        locationProvider = location
    }

    public func issueCredential(sessionId: String) async -> Result<IssuedCredential, OwnerRouteFailure> {
        guard let location, StudioLocation.isSessionId(sessionId) else { return .failure(.gone) }
        guard let answer = await request(path: "\(location.sessionsPath)/\(sessionId)/credential", method: "POST") else {
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

    private func request(path: String, method: String) async -> (status: Int, text: String?)? {
        guard let location, let webView = webViewProvider(), let url = webView.url, location.isStudio(url) else { return nil }
        let script = """
        const response = await fetch(path, {
          method: method, credentials: "same-origin",
          headers: method === "POST" ? { "content-type": "application/json" } : {} });
        return { status: response.status, text: response.ok ? await response.text() : null };
        """
        let value = try? await webView.callAsyncJavaScript(
            script, arguments: ["path": path, "method": method], in: nil, contentWorld: world)
        guard let object = value as? [String: Any], let status = object["status"] as? Int else { return nil }
        return (status, object["text"] as? String)
    }
}
