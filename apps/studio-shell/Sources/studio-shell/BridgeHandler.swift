import AppKit
import CaptureCore
import CoreGraphics
import StudioShellCore
import StudioShellEngine
import WebKit

// Answers `window.studioHost` calls. [SAFETY] Only a message from the main
// frame of the shell's own web view, at exactly Studio's origin, is answered
// (BridgeTrust); every body is decoded and bounded by Core first; the only
// capabilities are the typed ones in HostCall (no filesystem, shell or HTTP
// proxy). The shell never starts an analysis: it returns pixels to the page,
// and the page posts them to Studio's owner-authenticated capture route. The
// paired capture credential is not reachable from here.
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    let model: ShellModel
    private let capture: ShellCapture
    private let setPinned: (Bool) -> Void
    // The one entry every presentation command goes through (the same one the menu and keys use).
    private let engine: HandsFreeEngine
    private let perform: (PresentationCommand) -> PresentationState
    // One capture at a time; a second request while one runs is a visible loss.
    private let gate = CaptureGate()
    private let watcher: ScreenWatcher
    private let watchSampler: ShellScreenSampler

    init(
        model: ShellModel, capture: ShellCapture, engine: HandsFreeEngine, setPinned: @escaping (Bool) -> Void,
        perform: @escaping (PresentationCommand) -> PresentationState
    ) {
        self.engine = engine
        self.perform = perform
        self.model = model
        self.capture = capture
        watchSampler = ShellScreenSampler(capture: capture)
        watcher = ScreenWatcher(sampler: watchSampler)
        self.setPinned = setPinned
    }

    // Wired by the app: where watch events and status go (every hosted page).
    var onWatchChange: (Int, Int) -> Void {
        get { watcher.onChange }
        set { watcher.onChange = newValue }
    }
    var onWatchStatus: (ScreenWatchStatus) -> Void {
        get { watcher.onStatus }
        set { watcher.onStatus = newValue }
    }
    var watchStatus: ScreenWatchStatus { watcher.status }
    // Disconnect, sign-out, quit: the watch ends with them.
    func stopWatching() { watcher.stop() }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let origin = message.frameInfo.securityOrigin
        let sender = SenderFacts(
            isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host,
            port: origin.port, isIntendedWebView: model.owns(message.webView))
        guard BridgeTrust.accepts(sender, location: model.location) else { return replyHandler(nil, "refused") }
        // Engine methods are decoded by the engine's own module; the credential
        // never crosses this bridge.
        if let engineCall = EngineCallDecoder.decode(message.body) {
            switch engineCall {
            case .failure: replyHandler(nil, "invalid")
            case .success(let call):
                Task { @MainActor in
                    let reply = await EngineBridge.perform(call, on: self.engine)
                    replyHandler(reply, nil)
                }
            }
            return
        }
        switch HostCallDecoder.decode(message.body) {
        case .failure: replyHandler(nil, "invalid")
        case .success(.pinOnTop(let pinned)):
            model.pinned = pinned
            setPinned(pinned)
            replyHandler(pinned, nil)
        case .success(.presentation(let command)):
            let state = perform(command)
            replyHandler(HostReply.tookEffect(command, state), nil)
        case .success(.screenWatchStart(let request)):
            let ticket = model.epoch.ticket()
            Task { @MainActor in
                let failure = await self.watcher.start(request)
                replyHandler(HostReply.screenWatchStarted(failure), nil)
                _ = ticket
            }
        case .success(.screenWatchStop):
            watcher.stop()
            replyHandler(nil, nil)
        case .success(.openExternal(let url)):
            NSWorkspace.shared.open(url)
            replyHandler(nil, nil)
        case .success(.captureScreen(let request, let displayId)):
            // Sampled now, before any await and before the panel can take focus.
            let sample = capture.sample()
            let ticket = model.epoch.ticket()
            let senderView = message.webView
            Task { @MainActor in
                // One capture in flight; a repeat while one runs is a visible loss.
                let reply: Any? = await self.gate.run {
                    // Screen Recording is asked for once per launch; afterwards a
                    // missing grant is a plain typed refusal.
                    // [SAFETY] Only a browser in front is captured.
                    let frontId = sample.focusedPid.flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier }
                    guard BrowserFocus.allows(bundleId: frontId) else { return HostReply.failure(BrowserFocus.refusal) }
                    let granted = CGPreflightScreenCaptureAccess()
                    guard granted else {
                        if self.gate.shouldPromptForAccess(granted: false) { _ = CGRequestScreenCaptureAccess() }
                        return HostReply.failure("permission-denied")
                    }
                    let result = await self.capture.capture(request, displayId: displayId, sample: sample)
                    // [SAFETY] A navigation, sign-out or rebind since receipt, or a
                    // page no longer at Studio's origin, drops the frame.
                    guard self.model.epoch.isCurrent(ticket), self.model.isAtStudio(senderView) else { return nil }
                    return HostReply.capture(result.outcome, screenAccessGranted: true, displayId: result.displayId)
                } ?? HostReply.failure("capture-failed")
                if reply == nil { return replyHandler(nil, "stale") }
                replyHandler(reply, nil)
            }
        }
    }
}
