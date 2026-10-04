import AppKit
import CaptureAdapters
import CaptureCore
import Foundation
import StudioShellCore
import WebKit

// What the shell currently knows: where Studio is, whether it answers, the
// session list the menu shows, and the pin. Every change calls `onChange`.
final class ShellModel {
    private(set) var location: StudioLocation?
    private(set) var connection: ConnectionState = .notPaired
    private(set) var sessions: [SessionChoice] = []
    private(set) var current: SessionChoice?
    var onChange: () -> Void = {}

    let pairing = StudioPairing(credentials: KeychainCredentialStore(), paths: CompanionPaths())
    weak var webView: WKWebView?
    private let probeSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 5
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    var pinned: Bool {
        get { UserDefaults.standard.object(forKey: "pinned") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "pinned") }
    }

    func load() {
        location = pairing.current()
        connection = ConnectionRules.state(paired: location != nil, probe: nil)
        onChange()
    }

    func paired(_ location: StudioLocation) {
        self.location = location
        connection = .connecting
        sessions = []
        current = nil
        onChange()
    }

    func disconnect() {
        pairing.forget()
        location = nil
        sessions = []
        current = nil
        connection = .notPaired
        onChange()
    }

    // [SAFETY] The probe is a plain GET of Studio's public manifest: no cookie,
    // no credential, no content.
    func refresh() {
        guard let location else { return }
        Task { @MainActor in
            let result: ProbeResult
            do {
                let (_, response) = try await probeSession.data(from: location.probeURL)
                result = .answered(status: (response as? HTTPURLResponse)?.statusCode ?? 0)
            } catch {
                result = .noAnswer
            }
            connection = ConnectionRules.state(paired: true, probe: result)
            onChange()
            if connection.isConnected { await refreshSessions() }
        }
    }

    // Calls a Studio session route from inside the web view, with the person's
    // own sign-in; the shell sees only the response text.
    @MainActor
    func studioFetch(path: String, method: String = "GET", body: String? = nil) async -> String? {
        guard let webView else { return nil }
        let script = """
        const response = await fetch(path, {
          method: method, credentials: "same-origin",
          headers: body === null ? {} : { "content-type": "application/json" },
          body: body });
        return response.ok ? await response.text() : null;
        """
        let value = try? await webView.callAsyncJavaScript(
            script, arguments: ["path": path, "method": method, "body": body as Any? ?? NSNull()],
            in: nil, contentWorld: .page)
        return value as? String
    }

    @MainActor
    func refreshSessions() async {
        guard let location else { return }
        if let list = await studioFetch(path: location.sessionsPath) { sessions = SessionChoices.parseList(list) }
        if let now = await studioFetch(path: location.sessionsPath + "/current") {
            current = SessionChoices.parseCurrent(now)
        }
        onChange()
    }

    @MainActor
    func togglePause() async {
        guard let location, let current else { return }
        _ = await studioFetch(
            path: "\(location.sessionsPath)/\(current.id)/control", method: "POST",
            body: SessionChoices.controlBody(pause: !current.isPaused))
        await refreshSessions()
    }
}
