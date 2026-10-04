import AppKit
import StudioShellCore
import WebKit

// The web view that hosts the overlay route. Sign-in lives in WebKit's own
// persistent store (the same cookies Studio uses in a browser); the shell never
// reads them. Navigation stays on Studio's origin: anything else opens in the
// person's browser.
final class StudioWebViewDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let model: ShellModel

    init(model: ShellModel) { self.model = model }

    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if let location = model.location, location.isStudio(url) || url.scheme == "about" {
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.refresh() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { model.refresh() }
    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) { model.refresh() }
}

enum StudioWebView {
    static func make(handler: BridgeHandler, delegate: StudioWebViewDelegate) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let script = WKUserScript(
            source: HostBridgeScript.source(capabilities: HostCapability.allCases),
            injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        configuration.userContentController.addScriptMessageHandler(
            handler, contentWorld: .page, name: HostBridge.handlerName)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        view.allowsBackForwardNavigationGestures = false
        return view
    }
}
