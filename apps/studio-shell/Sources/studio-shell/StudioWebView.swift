import AppKit
import StudioShellCore
import StudioShellEngine
import WebKit

// The web view that hosts the overlay route. [SAFETY] Sign-in lives in WebKit's
// own PERSISTENT default store, chosen explicitly: the person signs in once to
// Studio inside this app and stays signed in across launches, for as long as
// Studio's own session lasts. It is the app's own store (not Safari's) and holds
// only Studio. The shell never reads it; Disconnect and a rebind to another
// origin erase it. The Keychain pairing credential is never given to the page
// and never authenticates it: the page uses its own cookie session only. Navigation stays on Studio's origin: anything else opens in the
// person's browser.
final class StudioWebViewDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let model: ShellModel
    // The URL of the page ON SCREEN (committed), never a pending one. While a redirect
    // is being decided, `webView.url` already names the redirect's TARGET, so asking it
    // whether "a Studio page is showing" answered yes for the sign-in page the shell
    // was about to cancel, and the shell's own sign-in panel never loaded.
    private var committedURL: URL?
    private func studioPageOnScreen() -> Bool {
        guard let location = model.location, let committedURL else { return false }
        return location.isStudio(committedURL)
    }
    // A page finished loading: the shell pushes it the presentation state and screen-watch status.
    var onPageFinished: (WKWebView) -> Void = { _ in }

    init(model: ShellModel) { self.model = model }

    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let url = action.request.url
        let isMainFrame = action.targetFrame?.isMainFrame ?? true
        switch NavigationPolicy.decide(url: url, isMainFrame: isMainFrame, location: model.location) {
        case .cancel:
            decisionHandler(.cancel)
        case .requestSignIn:
            model.onSignInRequested()
            decisionHandler(.cancel)
        case .requestChangeConnection:
            model.onChangeConnectionRequested()
            decisionHandler(.cancel)
        case .showSignIn:
            // [SAFETY] Studio's sign-in page, or a login provider's page, is never
            // shown in this privileged web view: the person signs in in their own
            // browser (the sign-in panel's buttons start that, then a one-time code
            // comes back). Other external links still open in the browser.
            // With none of Studio's own pages on screen (a first launch, or storage
            // cleared) the window would stay empty and see-through: show Studio's public
            // sign-in panel, which draws the same panel with its Google, LinkedIn and
            // local choices. A Studio page already showing keeps itself.
            if let location = model.location {
                if !studioPageOnScreen() {
                    let panel = location.signInPanelURL(notice: model.signInNotice)
                    model.signInNotice = nil
                    DispatchQueue.main.async { webView.load(URLRequest(url: panel)) }
                }
            }
            decisionHandler(.cancel)
        case .allow(let startsNewPage):
            // A new main-frame page is a new generation: privileged requests
            // made by the previous page must not be answered to this one.
            if startsNewPage { model.epoch.advance() }
            decisionHandler(.allow)
        case .openExternally:
            if let url, let external = HostCallDecoder.externalURL(url.absoluteString) {
                NSWorkspace.shared.open(external)
            }
            decisionHandler(.cancel)
        }
    }

    // A link that wants a new window opens in the person's browser.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, let external = HostCallDecoder.externalURL(url.absoluteString) {
            NSWorkspace.shared.open(external)
        }
        return nil
    }

    // [SAFETY] Studio's own pages in this shell may use the microphone and camera;
    // anything else is refused. Answering here (instead of letting WebKit ask) stops
    // every panel page raising its own "allow the microphone?" prompt: macOS still
    // asks once for the app itself.
    func webView(
        _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let allowed = NavigationPolicy.mediaCaptureAllowed(
            originScheme: origin.protocol, host: origin.host, port: origin.port,
            isMainFrame: frame.isMainFrame, location: model.location)
        decisionHandler(allowed ? .grant : .deny)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { model.epoch.advance() }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        committedURL = webView.url
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model.refresh()
        onPageFinished(webView)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { model.refresh() }
    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) {
        model.refresh()
        // [SAFETY] Nothing of Studio's on screen and its server will not answer: an
        // opaque "can't reach Studio" screen, never an empty or see-through window.
        // A navigation the shell cancelled on purpose (the sign-in redirect) is not a failure.
        let failure = error as NSError
        if NavigationFailure.isDeliberateCancel(domain: failure.domain, code: failure.code) { return }
        if !studioPageOnScreen() {
            let tried = model.location?.origin.absoluteString ?? ""
            webView.loadHTMLString(SignedOutScreen.html(address: tried), baseURL: nil)
        }
    }
}

// A floating panel is rarely the key window. Without this, the first click on a
// control inside it is spent making the window key and does nothing.
final class PanelWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

enum StudioWebView {
    static func make(handler: BridgeHandler, delegate: StudioWebViewDelegate) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let script = WKUserScript(
            source: HostBridgeScript.source(
                capabilities: HostCapability.offered(textRecognitionAvailable: VisionTextObserver.available),
                engineObject: EngineBridge.pageObjectSource,
                engineEmit: EngineBridge.pageEmitSource),
            injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        // The consent flag the panels read, set before any page script runs.
        if let source = Consent.pageScript(UserDefaultsStore()) {
            configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.userContentController.addScriptMessageHandler(
            handler, contentWorld: .page, name: HostBridge.handlerName)
        let view = PanelWebView(frame: .zero, configuration: configuration)
        handler.model.register(view)
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        view.allowsBackForwardNavigationGestures = false
        return view
    }
}
