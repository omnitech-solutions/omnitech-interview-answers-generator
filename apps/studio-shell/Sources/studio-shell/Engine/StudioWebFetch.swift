import Foundation
import StudioShellCore
import WebKit

// [SAFETY] The one way the shell calls a Studio route from inside the signed-in
// web view, so Studio sees the person's own session and the shell never holds
// their cookie. The request runs in a private WKContentWorld: its answer comes
// back to native code as a status and a string, and a page that replaced `fetch`
// in its own world can neither see this call nor forge its answer (the session
// list, the pause target and the engine credential all depend on that).
public struct StudioAnswer: Equatable, Sendable {
    public let status: Int
    public let text: String?

    public init(status: Int, text: String?) {
        self.status = status
        self.text = text
    }
}

@MainActor
public enum StudioWebFetch {
    nonisolated static let worldName = "studio-shell-engine"
    private static let world = WKContentWorld.world(name: worldName)

    // Arguments: path, method, body (a JSON string or null). A JSON content type
    // goes with a body and with a POST (the credential route takes none).
    nonisolated public static let script = """
        const response = await fetch(path, {
          method: method, credentials: "same-origin",
          headers: body === null && method !== "POST" ? {} : { "content-type": "application/json" },
          body: body });
        return { status: response.status, text: response.ok ? await response.text() : null };
        """

    // nil when the view is not at Studio's origin or the script gave no answer.
    public static func run(
        in webView: WKWebView?, at location: StudioLocation?, path: String, method: String = "GET", body: String? = nil
    ) async -> StudioAnswer? {
        guard let webView, let location, let url = webView.url, location.isStudio(url) else { return nil }
        let value = try? await webView.callAsyncJavaScript(
            script, arguments: ["path": path, "method": method, "body": body as Any? ?? NSNull()],
            in: nil, contentWorld: world)
        return answer(from: value)
    }

    nonisolated public static func answer(from value: Any?) -> StudioAnswer? {
        guard let object = value as? [String: Any], let status = object["status"] as? Int else { return nil }
        return StudioAnswer(status: status, text: object["text"] as? String)
    }
}
