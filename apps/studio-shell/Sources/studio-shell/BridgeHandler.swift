import AppKit
import CaptureAdapters
import CaptureCore
import CoreGraphics
import StudioShellCore
import WebKit

// Answers `window.studioHost` calls. [SAFETY] Only the main frame of Studio's
// own origin is answered; every message is decoded and bounded by Core first.
// The shell never starts an analysis: it returns pixels to the page, and the page
// posts them to Studio's owner-authenticated capture route.
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let model: ShellModel
    private let setPinned: (Bool) -> Void

    init(model: ShellModel, setPinned: @escaping (Bool) -> Void) {
        self.model = model
        self.setPinned = setPinned
    }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame, let location = model.location,
            location.isStudio(
                scheme: message.frameInfo.securityOrigin.protocol, host: message.frameInfo.securityOrigin.host,
                port: message.frameInfo.securityOrigin.port == 0 ? nil : message.frameInfo.securityOrigin.port)
        else { return replyHandler(nil, "refused") }
        switch HostCallDecoder.decode(message.body) {
        case .failure: replyHandler(nil, "invalid")
        case .success(.pinOnTop(let pinned)):
            model.pinned = pinned
            setPinned(pinned)
            replyHandler(pinned, nil)
        case .success(.openExternal(let url)):
            NSWorkspace.shared.open(url)
            replyHandler(nil, nil)
        case .success(.captureScreen(let request)):
            Task { @MainActor in
                // The person pressed Analyze: asking for Screen Recording now is
                // the one place macOS may prompt.
                guard CGPreflightScreenCaptureAccess() else {
                    _ = CGRequestScreenCaptureAccess()
                    return replyHandler(HostReply.failure("permission-denied"), nil)
                }
                let outcome = await ScreenKitOneShot.capture(request)
                replyHandler(HostReply.capture(outcome, screenAccessGranted: CGPreflightScreenCaptureAccess()), nil)
            }
        }
    }
}
