import AppKit
import CaptureAdapters
import CaptureCore
import Foundation
import StudioShellCore
import StudioShellEngine
import WebKit

// What the shell currently knows: where Studio is, whether it answers, the
// session list the menu shows, and the pin. Every change calls `onChange`.
final class ShellModel {
    private(set) var location: StudioLocation?
    private(set) var connection: ConnectionState = .notPaired
    private(set) var sessions: [SessionChoice] = []
    private(set) var current: SessionChoice?
    var onChange: () -> Void = {}
    // Generation of the page that may receive privileged replies (BridgeEpoch).
    let epoch = BridgeEpoch()
    // The web view's own sign-in as Studio answers it (nil: not yet known).
    private(set) var signedIn: Bool?
    // Whether Studio has a real login provider (nil: not asked yet). Without one
    // the shell never prompts to sign in: the default dev user needs none.
    private(set) var signInAvailable: Bool?
    // Set by the app: runs the native sign-in round trip / abandons it.
    var onSignInRequested: () -> Void = {}
    var onSignInAbandoned: () -> Void = {}
    private var lastProbe: ProbeResult?

    let pairing = StudioPairing(credentials: KeychainCredentialStore(), paths: CompanionPaths())
    // Every web view the shell hosts (main window, compact window, panels). Each
    // is the same Studio origin and the same persistent data store, and each is
    // trusted by the bridge only while it is registered here (BridgeTrust).
    private let hostedViews = NSHashTable<WKWebView>.weakObjects()
    func register(_ view: WKWebView) { hostedViews.add(view) }
    func owns(_ view: WKWebView?) -> Bool { view.map { hostedViews.contains($0) } ?? false }
    // One view at Studio's origin, for calls the shell makes through a page
    // (the session list, sign-in redemption); nil when none is loaded.
    var webView: WKWebView? {
        let views = hostedViews.allObjects
        guard let location else { return views.first }
        return views.first { $0.url.map(location.isStudio) ?? false } ?? views.first
    }
    func isAtStudio(_ view: WKWebView?) -> Bool {
        guard let location, let url = view?.url else { return false }
        return location.isStudio(url)
    }
    var allViews: [WKWebView] { hostedViews.allObjects }

    let prefs = ShellPrefs(store: UserDefaultsStore())
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

    // [SAFETY] A rebind (new address or workspace) invalidates in-flight
    // requests, forgets the old sign-in and, when the origin changed, erases the
    // web view's stored site data so one origin's session never meets another.
    func paired(_ location: StudioLocation) {
        let previous = self.location
        epoch.advance()
        onSignInAbandoned()
        signedIn = nil
        signInAvailable = nil
        lastProbe = nil
        if previous?.origin != location.origin { clearWebsiteData() }
        self.location = location
        connection = .connecting
        sessions = []
        current = nil
        onChange()
    }

    func disconnect() {
        epoch.advance()
        onSignInAbandoned()
        clearWebsiteData()
        for view in allViews { view.load(URLRequest(url: URL(string: "about:blank")!)) }
        signedIn = nil
        signInAvailable = nil
        lastProbe = nil
        pairing.forget()
        location = nil
        sessions = []
        current = nil
        connection = .notPaired
        onChange()
    }

    // Signs the web view out of everything it stored (it holds only Studio).
    func clearWebsiteData() {
        let store = WKWebsiteDataStore.default()
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
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
            lastProbe = result
            connection = ConnectionRules.state(
                paired: true, probe: result, signedIn: signedIn, signInAvailable: signInAvailable)
            onChange()
            if connection.isConnected { await refreshSessions() }
        }
    }

    // Calls a Studio session route from inside the web view, with the person's
    // own sign-in, in the shell's private content world (StudioWebFetch).
    @MainActor
    func studioFetch(path: String, method: String = "GET", body: String? = nil) async -> StudioAnswer? {
        await StudioWebFetch.run(in: webView, at: location, path: path, method: method, body: body)
    }

    // 401/403 from Studio's own session route means the web view is signed out
    // or expired: the state says so ("Sign in to Studio") instead of failing
    // silently, and a drop from signed-in invalidates in-flight requests.
    @MainActor
    private func noteAuth(status: Int) {
        let now: Bool? = status == 401 || status == 403 ? false : (status == 200 ? true : signedIn)
        if signedIn == true, now == false { epoch.advance() }
        signedIn = now
        if now != false { signInAvailable = nil }
        if let lastProbe {
            connection = ConnectionRules.state(
                paired: true, probe: lastProbe, signedIn: signedIn, signInAvailable: signInAvailable)
        }
    }

    // Asked only once Studio says signed out: a plain, cookie-free GET of
    // Studio's public providers route. An unanswered ask means no prompt.
    @MainActor
    private func refreshSignInAvailability() async {
        guard let location, signedIn == false, signInAvailable == nil else { return }
        var available = false
        if let (data, response) = try? await probeSession.data(from: location.signInProvidersURL),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            available = object["configured"] as? Bool ?? false
        }
        signInAvailable = available
        if let lastProbe {
            connection = ConnectionRules.state(
                paired: true, probe: lastProbe, signedIn: signedIn, signInAvailable: signInAvailable)
        }
    }

    @MainActor
    func refreshSessions() async {
        guard let location else { return }
        if let list = await studioFetch(path: location.sessionsPath) {
            noteAuth(status: list.status)
            await refreshSignInAvailability()
            if let text = list.text { sessions = SessionChoices.parseList(text) } else { sessions = [] }
        }
        if signedIn != false, let now = await studioFetch(path: location.sessionsPath + "/current"),
            let text = now.text
        {
            current = SessionChoices.parseCurrent(text)
        } else if signedIn == false {
            current = nil
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

// UserDefaults behind the Core's SettingsStore: window frames, mode and
// visibility only. Never content, an address or a credential.
struct UserDefaultsStore: SettingsStore {
    func string(forKey key: String) -> String? { UserDefaults.standard.string(forKey: "shell." + key) }
    func set(_ value: String?, forKey key: String) {
        if let value { UserDefaults.standard.set(value, forKey: "shell." + key) } else { UserDefaults.standard.removeObject(forKey: "shell." + key) }
    }
}
