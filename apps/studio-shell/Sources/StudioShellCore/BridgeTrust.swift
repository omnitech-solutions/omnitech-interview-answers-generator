import CaptureCore
import Foundation

// [SAFETY] Who may talk to the native bridge, and which replies may still be
// delivered. Pure decisions, so they are tested without WebKit.

// What the handler reads off a WKScriptMessage before it looks at the body.
public struct SenderFacts: Equatable, Sendable {
    public let isMainFrame: Bool
    public let scheme: String?
    public let host: String?
    // WebKit reports 0 for a scheme's default port.
    public let port: Int?
    // The message came from the shell's own web view, not another WKWebView.
    public let isIntendedWebView: Bool

    public init(isMainFrame: Bool, scheme: String?, host: String?, port: Int?, isIntendedWebView: Bool) {
        self.isMainFrame = isMainFrame
        self.scheme = scheme
        self.host = host
        self.port = port
        self.isIntendedWebView = isIntendedWebView
    }
}

public enum BridgeTrust {
    // Main frame, the intended web view, and exactly the configured Studio
    // origin (scheme, host and port). Anything else is ignored.
    public static func accepts(_ sender: SenderFacts, location: StudioLocation?) -> Bool {
        guard sender.isMainFrame, sender.isIntendedWebView, let location else { return false }
        let port = sender.port == 0 ? nil : sender.port
        return location.isStudio(scheme: sender.scheme, host: sender.host, port: port)
    }
}

// Privileged requests are tied to the page generation that made them. A
// navigation, sign-out or rebind advances the generation; a reply whose ticket
// is no longer current is dropped, so pixels never reach another page or origin.
// Used from the main thread only (the web view, its delegate and the handler).
public final class BridgeEpoch {
    public struct Ticket: Equatable, Sendable { fileprivate let value: UInt64 }

    private var value: UInt64 = 0

    public init() {}

    public func ticket() -> Ticket { Ticket(value: value) }
    public func advance() { value &+= 1 }
    public func isCurrent(_ ticket: Ticket) -> Bool { ticket.value == value }
}

// [SAFETY] "Focused window" is the application that was frontmost when the
// request arrived, sampled before the panel can take focus; the shell is never
// that application. If the shell itself is frontmost, the last other
// application stands in; with none, there is no focused window (never widened).
public enum FocusSampling {
    public static func sample(frontmost: Int32?, ownPid: Int32, lastOther: Int32?) -> Int32? {
        guard let frontmost else { return lastOther }
        return frontmost == ownPid ? lastOther : frontmost
    }

    // The window to capture, never one of the shell's own.
    public static func choose(sampledPid: Int32?, ownPid: Int32, windows: [WindowCandidate]) -> Int? {
        guard let sampledPid, sampledPid != ownPid else { return nil }
        let others = windows.map {
            $0.ownerPid == ownPid
                ? WindowCandidate(ownerPid: -1, layer: $0.layer, isOnScreen: false, width: 0, height: 0) : $0
        }
        return FocusedWindow.choose(frontmostPid: sampledPid, windows: others)
    }
}

// [SAFETY] A region is normalised to one display. A request that names a
// display must still find it as the main display; one that names none uses the
// display sampled at receipt, and a change before pixels are taken refuses.
public enum DisplayBinding {
    public static func allows(requested: UInt32?, sampled: UInt32, current: UInt32) -> Bool {
        if let requested, requested != sampled { return false }
        return sampled == current
    }
}
