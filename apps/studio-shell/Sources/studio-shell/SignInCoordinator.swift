import AppKit
import AuthenticationServices
import StudioShellCore

// Runs Studio's sign-in in a system web-auth session (ASWebAuthenticationSession:
// the provider's cookies and passkeys live in the system's own browser state, not
// in this app's privileged web view) and hands the one-time code back to Studio
// inside the web view. The shell only ever opens Studio's own start URL; the
// provider pages are Studio's server's redirects inside that session. Nothing
// here is logged: no URL, code or nonce.
final class SignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let model: ShellModel
    private let anchor: () -> NSWindow?
    private var attempt = SignInAttempt()
    private var session: ASWebAuthenticationSession?

    init(model: ShellModel, anchor: @escaping () -> NSWindow?) {
        self.model = model
        self.anchor = anchor
    }

    // The menu item, or the web view reaching Studio's sign-in page.
    @MainActor
    func start() {
        guard let location = model.location,
            let url = attempt.begin(at: location, now: Date())
        else { return }
        let session = ASWebAuthenticationSession(
            url: url, callbackURLScheme: NativeSignIn.callbackScheme
        ) { [weak self] callback, _ in
            DispatchQueue.main.async { self?.finished(callback) }
        }
        session.presentationContextProvider = self
        // The system session keeps the provider's own cookies and passkeys, so a
        // second sign-in is quick; Studio's session never lives there for the shell.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        if !session.start() { cancel() }
    }

    @MainActor
    private func finished(_ callback: URL?) {
        session = nil
        guard let location = model.location, let callback else { return attempt.cancel() }
        // A cancel or an error arrives as no URL; a malformed one is refused.
        if case .success(let redeem) = attempt.receive(callback, at: location, now: Date()) {
            model.webView?.load(URLRequest(url: redeem))
        }
    }

    // Disconnect and rebind abandon an attempt in flight.
    @MainActor
    func cancel() {
        attempt.cancel()
        session?.cancel()
        session = nil
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor() ?? NSApp.keyWindow ?? ASPresentationAnchor()
    }
}
