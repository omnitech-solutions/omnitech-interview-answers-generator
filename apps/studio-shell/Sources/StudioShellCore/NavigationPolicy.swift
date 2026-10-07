import Foundation

// What the web view does with one navigation request.
public enum NavigationDecision: Equatable, Sendable {
    // Let it load. `startsNewPage`: a main-frame page is a new generation, so the
    // shell advances the epoch and the previous page's privileged requests lapse.
    case allow(startsNewPage: Bool)
    // Refuse it, no side effect.
    case cancel
    // The signed-out screen's button: cancel and ask the shell to start sign-in.
    case requestSignIn
    // The fallback screen's second button: cancel and open the connect prompt.
    case requestChangeConnection
    // Studio's sign-in page or a login provider's page: cancel, and show Studio's
    // native sign-in panel if none of Studio's own pages is on screen.
    case showSignIn
    // Not Studio's: cancel here; the shell hands the URL to the person's browser.
    case openExternally
}

// [SAFETY] [DOMAIN] The pure rules for what the privileged web view may load and
// which origins may use the microphone and camera (ADR-0019, SW-SEC-01). The
// delegate only performs the decision; keeping it here makes it testable without
// WebKit types.
public enum NavigationPolicy {
    // [STRATEGY] Order matters: the start link first (needs no location), then
    // sign-in pages and providers (main frame only), then Studio's own origin or
    // `about:`, and everything else leaves the web view.
    public static func decide(url: URL?, isMainFrame: Bool, location: StudioLocation?) -> NavigationDecision {
        guard let url else { return .cancel }
        // The fallback screen's button: only that screen can ask for it.
        if SignedOutScreen.isStart(url) { return .requestSignIn }
        if SignedOutScreen.isChangeConnection(url) { return .requestChangeConnection }
        if let location, isMainFrame, location.isSignInPage(url) || location.isLoginProvider(url) {
            return .showSignIn
        }
        if let location, location.isStudio(url) || url.scheme == "about" {
            return .allow(startsNewPage: isMainFrame)
        }
        return .openExternally
    }

    // [SAFETY] Camera and microphone: Studio's own origin in the main frame only.
    // WebKit reports the default port as 0.
    public static func mediaCaptureAllowed(
        originScheme: String, host: String, port: Int, isMainFrame: Bool, location: StudioLocation?
    ) -> Bool {
        guard isMainFrame, let location else { return false }
        let suffix = port == 0 ? "" : ":\(port)"
        guard let url = URL(string: "\(originScheme)://\(host)\(suffix)/") else { return false }
        return location.isStudio(url)
    }
}

// [DOMAIN] Which load failures are the shell's own doing. A navigation the shell
// cancels on purpose (the sign-in redirect, a fallback screen's button) is reported
// as a failed load: as NSURLErrorCancelled for a cancelled request, and as
// WebKitErrorDomain 102 ("frame load interrupted by a policy change") when the
// policy handler cancelled it. Either is deliberate and shows nothing; any other
// failure (the server is down, a timeout) is real and shows the fallback screen.
public enum NavigationFailure {
    public static func isDeliberateCancel(domain: String, code: Int) -> Bool {
        (domain == "NSURLErrorDomain" && code == -999)
            || (domain == "WebKitErrorDomain" && code == 102)
    }
}
