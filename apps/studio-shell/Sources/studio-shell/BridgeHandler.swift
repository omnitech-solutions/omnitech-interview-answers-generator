import AppKit
import CaptureAdapters
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
// What the page's `account` object may ask of the shell. The app supplies each.
struct AccountActions {
    var signIn: (SignInProvider) -> Bool = { _ in false }
    var cancelSignIn: () -> Void = {}
    var reopenSignIn: () -> Bool = { false }
    var copySignInLink: () -> Bool = { false }
    var signOut: () -> Bool = { false }
}

final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    let model: ShellModel
    var account = AccountActions()
    private let capture: ShellCapture
    private let setPinned: (Bool) -> Void
    // See-through masks only the compact window: its page alone may report hit regions.
    private let isCompactView: (WKWebView?) -> Bool
    // The one entry every presentation command goes through (the same one the menu and keys use).
    private let engine: HandsFreeEngine
    private let perform: (PresentationCommand) -> PresentationState
    // One capture at a time; a second request while one runs is a visible loss.
    private let gate = CaptureGate()
    // Recognition outside a capture (recognizeText): one at a time, a second is `busy`.
    private let recognitionGate = CaptureGate()
    // Previews of every display are rationed (single-flight, minimum interval).
    private let previewThrottle = PreviewThrottle<[(display: DisplayInfo, jpeg: Data)]>(
        now: { ProcessInfo.processInfo.systemUptime })
    private let watcher: ScreenWatcher
    private let watchSampler: ShellScreenSampler

    init(
        model: ShellModel, capture: ShellCapture, engine: HandsFreeEngine, setPinned: @escaping (Bool) -> Void,
        isCompactView: @escaping (WKWebView?) -> Bool,
        perform: @escaping (PresentationCommand) -> PresentationState
    ) {
        self.engine = engine
        self.perform = perform
        self.model = model
        self.capture = capture
        watchSampler = ShellScreenSampler(capture: capture)
        watcher = ScreenWatcher(sampler: watchSampler)
        self.setPinned = setPinned
        self.isCompactView = isCompactView
    }

    // Wired by the app: where watch events and status go (every hosted page).
    var onWatchChange: (Int, Int, DisplayInfo?) -> Void {
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

    // The page origin of the event log: the method name only, plus a
    // presentation op; parameters stay out (they may carry a URL or image).
    private func recordPageCall(_ message: WKScriptMessage) {
        let body = message.body as? [String: Any]
        var fields = ["method": body?["method"] as? String ?? "unknown", "channel": message.name]
        if let op = (body?["params"] as? [String: Any])?["op"] as? String { fields["op"] = op }
        EventLog.shared.record(.page, "bridge.call", fields)
    }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        recordPageCall(message)
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
            // [GUARD] A hit-region report from any other hosted view (Settings, the main window)
            // is refused: it would mask the compact window with another page's rectangles.
            if case .setHitRegions = command, !isCompactView(message.webView) { return replyHandler(false, nil) }
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
        case .success(.recognizeText(_, let base64)):
            // The image stays in this call: it is decoded, read and dropped, never stored or logged.
            let ticket = model.epoch.ticket()
            let senderView = message.webView
            Task { @MainActor in
                // [GUARD] One recognition at a time: N parallel `.accurate` runs would hold N images.
                guard
                    let outcome = await self.recognitionGate.run({
                        await self.capture.recognizer.recognize(base64: base64)
                    })
                else { return replyHandler(HostReply.failure("busy"), nil) }
                guard self.model.epoch.isCurrent(ticket), self.model.isAtStudio(senderView) else {
                    return replyHandler(nil, "stale")
                }
                replyHandler(HostReply.recognition(outcome), nil)
            }
        case .success(.listDisplays(thumbnails: false)):
            // The displays by name and the pin, no capture: so no Screen Recording needed either.
            let infos = Displays.infos()
            let pin = capture.pin.snapshot(available: infos.map(\.id))
            replyHandler(
                HostReply.displayListWithoutThumbnails(infos, pinnedDisplayId: pin.id, pinFallback: pin.fallback), nil)
        case .success(.listDisplays(thumbnails: true)):
            // Owner-visible previews: not capture input, so the browser gate does not apply (a
            // known exception: they show every display, other apps included, plan 7.0s T34),
            // but Screen Recording does, and they are rationed: single-flight with a minimum
            // interval, the previous result answering a repeat. Held by the page in memory only.
            guard CGPreflightScreenCaptureAccess() else {
                return replyHandler(HostReply.failure("permission-denied"), nil)
            }
            let ticket = model.epoch.ticket()
            let senderView = message.webView
            switch previewThrottle.begin() {
            case .busy: return replyHandler(HostReply.failure("busy"), nil)
            case .reuse(let previews):
                let pinNow = capture.pin.snapshot(available: Displays.infos().map(\.id))
                return replyHandler(
                    HostReply.displayList(previews, pinnedDisplayId: pinNow.id, pinFallback: pinNow.fallback), nil)
            case .run: break
            }
            Task { @MainActor in
                let previews = await self.capture.previews()
                self.previewThrottle.finish(previews)
                guard self.model.epoch.isCurrent(ticket), self.model.isAtStudio(senderView) else {
                    return replyHandler(nil, "stale")
                }
                let pin = self.capture.pin.snapshot(available: Displays.infos().map(\.id))
                replyHandler(
                    previews.map { HostReply.displayList($0, pinnedDisplayId: pin.id, pinFallback: pin.fallback) }
                        ?? HostReply.failure("capture-failed"), nil)
            }
        case .success(.setCaptureDisplay(let id)):
            let infos = Displays.infos()
            guard capture.pin.set(id, available: infos.map(\.id)) else {
                return replyHandler(HostReply.failure("display-unavailable"), nil)
            }
            replyHandler(HostReply.captureDisplaySet(infos.first { $0.id == id }), nil)
        case .success(.openExternal(let url)):
            NSWorkspace.shared.open(url)
            replyHandler(nil, nil)
        case .success(.signIn(let provider)): replyHandler(account.signIn(provider), nil)
        case .success(.cancelSignIn):
            account.cancelSignIn()
            replyHandler(nil, nil)
        case .success(.reopenSignIn): replyHandler(account.reopenSignIn(), nil)
        case .success(.copySignInLink): replyHandler(account.copySignInLink(), nil)
        case .success(.signOut): replyHandler(account.signOut(), nil)
        case .success(.permissions): replyHandler(permissionsReply(), nil)
        case .success(.setCallAudio(let source)):
            // Takes effect when listening next starts; a tap that failed earlier gets a fresh attempt.
            model.prefs.callAudio = source
            ApplicationAudioSource.forgetTapEvidence()
            CompanionEvents.record(.user, "audio.call_source_set", ["source": source.rawValue])
            replyHandler(permissionsReply(), nil)
        case .success(.captureScreen(let request, let displayId, let intent)):
            // Sampled now, before any await and before the panel can take focus.
            let sample = capture.sample(intent: intent)
            let ticket = model.epoch.ticket()
            let senderView = message.webView
            Task { @MainActor in
                // One capture in flight; a repeat while one runs is a visible loss. The slot covers
                // only the frame: recognition (below) runs after it is released, so a slow Vision
                // run never holds the next capture.
                let captured: (reply: [String: Any]?, result: ShellCapture.Result?)? = await self.gate.run {
                    // Screen Recording is asked for once per launch; afterwards a
                    // missing grant is a plain typed refusal.
                    // [SAFETY] Only a browser is captured: the one in front, or (for the person's
                    // own request) the last one focused, and only while it has an on-screen window.
                    // Otherwise say what was in front.
                    guard sample.focusedPid != nil else {
                        return (HostReply.failure(BrowserFocus.refusal, frontApp: sample.frontAppName), nil)
                    }
                    let granted = CGPreflightScreenCaptureAccess()
                    guard granted else {
                        if self.gate.shouldPromptForAccess(granted: false) { _ = CGRequestScreenCaptureAccess() }
                        return (HostReply.failure("permission-denied"), nil)
                    }
                    let result = await self.capture.capture(request, displayId: displayId, sample: sample)
                    return (nil, result)
                }
                // Another capture is already running (a repeat press, or Auto's own).
                guard let captured else { return replyHandler(HostReply.failure("busy"), nil) }
                if let refusal = captured.reply { return replyHandler(refusal, nil) }
                guard let result = captured.result else { return replyHandler(nil, "stale") }
                // [SAFETY] A navigation, sign-out or rebind since receipt, or a
                // page no longer at Studio's origin, drops the frame.
                guard self.model.epoch.isCurrent(ticket), self.model.isAtStudio(senderView) else {
                    return replyHandler(nil, "stale")
                }
                // The text is read from the very bytes the page receives, within a hard budget.
                // Any failure (timeout, unavailable) leaves the capture without `ocr`.
                var ocr: OcrText?
                if case .image(let jpeg, _) = result.outcome,
                    case .recognized(let text) = await self.capture.recognizer.recognize(
                        jpeg, within: ShellCapture.captureOcrBudget)
                {
                    ocr = text
                }
                guard self.model.epoch.isCurrent(ticket), self.model.isAtStudio(senderView) else {
                    return replyHandler(nil, "stale")
                }
                replyHandler(
                    HostReply.capture(
                        result.outcome, screenAccessGranted: true, displayId: result.displayId, ocr: ocr,
                        display: result.display, pinned: result.pinned, pinFallback: result.pinFallback), nil)
            }
        }
    }

    // The Mac's permission states plus what the call's audio depends on right now.
    private func permissionsReply() -> [String: Any] {
        let selected = model.prefs.callAudio
        let screen = ShellPermissions.screen()
        let system = ProcessInfo.processInfo.operatingSystemVersion
        let report = CallAudioReport(
            selected: selected, active: ApplicationAudioSource.carrier(for: selected).source,
            evidence: ApplicationAudioSource.tapEvidence, screen: screen,
            tapSupported: CallAudioSource.tapSupported(osMajor: system.majorVersion, osMinor: system.minorVersion))
        return HostReply.permissions(microphone: ShellPermissions.microphone(), screen: screen, callAudio: report)
    }
}
