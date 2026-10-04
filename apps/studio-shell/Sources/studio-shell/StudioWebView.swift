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
    // A page finished loading: the shell pushes it the presentation state and skill.
    var onPageFinished: (WKWebView) -> Void = { _ in }

    init(model: ShellModel) { self.model = model }

    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        // [SAFETY] Studio's sign-in page, or a login provider's page, is never
        // shown in this privileged web view: the native round trip (system
        // web-auth session, then a one-time code) replaces it. Only a main-frame
        // navigation counts, and only when Studio has a real provider; the
        // coordinator refuses to stack attempts. Other external links still open
        // in the browser.
        if let location = model.location, action.targetFrame?.isMainFrame ?? true,
            location.isSignInPage(url) || location.isLoginProvider(url)
        {
            if model.signInAvailable != false { model.onSignInRequested() }
            return decisionHandler(.cancel)
        }
        if let location = model.location, location.isStudio(url) || url.scheme == "about" {
            // A new main-frame page is a new generation: privileged requests
            // made by the previous page must not be answered to this one.
            if action.targetFrame?.isMainFrame ?? true { model.epoch.advance() }
            return decisionHandler(.allow)
        }
        if let external = HostCallDecoder.externalURL(url.absoluteString) { NSWorkspace.shared.open(external) }
        decisionHandler(.cancel)
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
        let port = origin.port == 0 ? "" : ":\(origin.port)"
        if frame.isMainFrame, let url = URL(string: "\(origin.protocol)://\(origin.host)\(port)/"),
            model.location?.isStudio(url) == true
        {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { model.epoch.advance() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model.refresh()
        onPageFinished(webView)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { model.refresh() }
    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) { model.refresh() }
}

enum StudioWebView {
    static func make(handler: BridgeHandler, delegate: StudioWebViewDelegate) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let script = WKUserScript(
            source: HostBridgeScript.source(
                capabilities: HostCapability.allCases, engineObject: EngineBridge.pageObjectSource,
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
        let view = WKWebView(frame: .zero, configuration: configuration)
        handler.model.register(view)
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        view.allowsBackForwardNavigationGestures = false
        return view
    }
}
