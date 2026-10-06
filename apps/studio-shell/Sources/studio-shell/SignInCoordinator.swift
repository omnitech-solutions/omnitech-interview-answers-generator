import AppKit
import StudioShellCore

// Runs Studio's sign-in in the person's DEFAULT browser and hands the one-time
// code back to Studio inside the web view. The panel (a page of Studio's own)
// asks for a provider; the shell opens Studio's own start address with the
// attempt nonce, waits for `omnitech-studio://signin?code=...` (the app's URL
// scheme, registered by bundle-app.sh) and redeems it in the web view, where
// Studio sets its own session cookie. The provider's pages run in the browser,
// never in this privileged web view. Nothing here is logged: no URL, code or nonce.
@MainActor
final class SignInCoordinator {
    private let model: ShellModel
    private var attempt = SignInAttempt()
    private var timer: Timer?
    private(set) var state: AccountState = .idle
    // Tells every hosted page the state (the panel's "waiting" screen).
    var onState: (AccountState) -> Void = { _ in }
    // Brings the app forward when the browser hands control back.
    var activate: () -> Void = { NSApp.activate(ignoringOtherApps: true) }

    init(model: ShellModel) { self.model = model }

    // The panel's "Continue with Google / LinkedIn". False while an attempt is
    // already live (a page cannot stack prompts) or the browser did not open.
    @discardableResult
    func start(_ provider: SignInProvider) -> Bool {
        guard let location = model.location,
            let url = attempt.begin(at: location, now: Date(), provider: provider)
        else { return false }
        guard NSWorkspace.shared.open(url) else {
            attempt.cancel()
            return false
        }
        set(.waiting(provider))
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: NativeSignIn.attemptTimeout, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.expire() }
        }
        return true
    }

    // "Open browser again": the same attempt, the same link.
    func reopen() -> Bool {
        guard let waiting = attempt.waiting(now: Date()) else { return false }
        return NSWorkspace.shared.open(waiting.url)
    }

    // "Copy link": the same link, to the clipboard; the page never reads it.
    func copyLink() -> Bool {
        guard let waiting = attempt.waiting(now: Date()) else { return false }
        let board = NSPasteboard.general
        board.clearContents()
        return board.setString(waiting.url.absoluteString, forType: .string)
    }

    // The app's URL-scheme handler: `omnitech-studio://signin?code=...`. Only the
    // pending attempt accepts it, once; anything else is dropped without a word.
    func handleCallback(_ url: URL) {
        guard let location = model.location else { return }
        let result = attempt.receive(url, at: location, now: Date())
        finish()
        if case .success(let redeem) = result {
            activate()
            model.webView?.load(URLRequest(url: redeem))
        }
    }

    // The person cancelled, or the shell rebound or disconnected.
    func cancel() {
        attempt.cancel()
        finish()
    }

    private func expire() {
        guard !attempt.isPending(now: Date()) else { return }
        attempt.cancel()
        timer = nil
        set(.timedOut)
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        set(.idle)
    }

    private func set(_ next: AccountState) {
        state = next
        onState(next)
    }
}
