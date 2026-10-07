import CoreGraphics
import Foundation

// [DOMAIN] Which display a capture comes from, and how a page is told. A display
// is named by the system (its localized name), never by what is on it: no window
// title and no address ever leaves through this type (rule 8).
public struct DisplayInfo: Equatable, Sendable {
    public static let maxNameLength = 64
    public let id: UInt32
    public let name: String
    // 1-based position in the system's screen order; `count` displays in all.
    public let index: Int
    public let count: Int

    public init(id: UInt32, name: String, index: Int, count: Int) {
        self.id = id
        self.name = name
        self.index = index
        self.count = count
    }

    // The closed wire object: exactly these four keys.
    public var wire: [String: Any] { ["id": Int(id), "name": name, "index": index, "count": count] }

    // `ids` is in the system's screen order; a display with no name is just "Display".
    public static func list(ids: [UInt32], names: [UInt32: String]) -> [DisplayInfo] {
        ids.enumerated().map { offset, id in
            // [SAFETY] The system's name, filtered like an application name (no control or bidi characters).
            return DisplayInfo(
                id: id, name: FrontAppName.sanitize(names[id]) ?? "Display",
                index: offset + 1, count: ids.count)
        }
    }
}

public struct DisplayFrame: Equatable, Sendable {
    public let id: UInt32
    // Global display coordinates (origin top-left), as CGDisplayBounds reports.
    public let frame: CGRect
    public init(id: UInt32, frame: CGRect) {
        self.id = id
        self.frame = frame
    }
}

// One on-screen window as the window server lists it: no title, only geometry.
public struct PlacedWindow: Equatable, Sendable {
    public let windowId: UInt32
    public let ownerPid: Int32
    public let layer: Int
    public let frame: CGRect
    public init(windowId: UInt32, ownerPid: Int32, layer: Int, frame: CGRect) {
        self.windowId = windowId
        self.ownerPid = ownerPid
        self.layer = layer
        self.frame = frame
    }
}

// [SAFETY] Pure decisions over the sampled application's windows. Only the
// sampled application is ever considered (never the shell, never another app),
// and a missing window is nil, never widened.
public enum CaptureTarget {
    // Overlays, tooltips and toolbars are small; a real document window is not.
    public static let minimumSide = 64.0

    // The FRONTMOST qualifying window of `sampledPid`; `ordered` is front-to-back
    // (the window server's on-screen order). With `on`, only a window whose centre
    // lies on that display qualifies (a pinned display).
    public static func frontmostWindow(
        sampledPid: Int32?, ownPid: Int32, ordered: [PlacedWindow], on display: DisplayFrame? = nil
    ) -> PlacedWindow? {
        guard let sampledPid, sampledPid != ownPid else { return nil }
        return ordered.first { window in
            window.ownerPid == sampledPid && window.layer == 0
                && window.frame.width >= minimumSide && window.frame.height >= minimumSide
                && display.map { $0.frame.contains(CGPoint(x: window.frame.midX, y: window.frame.midY)) } ?? true
        }
    }

    // [SAFETY] Every on-screen document window of the sampled browser, and ONLY those:
    // the allow-list a display or region capture is built from, so another app in
    // front of the browser on the same display is never rendered. Empty when the
    // browser has no on-screen window (hidden, minimised, on another Space; on the
    // pinned display when `on` is given): the capture is then refused, never widened
    // to whatever else the display shows.
    public static func browserWindowIds(
        sampledPid: Int32?, ownPid: Int32, ordered: [PlacedWindow], on display: DisplayFrame? = nil
    ) -> [UInt32] {
        guard let sampledPid, sampledPid != ownPid,
            frontmostWindow(sampledPid: sampledPid, ownPid: ownPid, ordered: ordered, on: display) != nil
        else { return [] }
        return ordered.filter {
            $0.ownerPid == sampledPid && $0.layer == 0 && $0.frame.width >= minimumSide
                && $0.frame.height >= minimumSide
        }.map(\.windowId)
    }

    // The display holding the centre of the frontmost qualifying window; none: `fallback`.
    public static func display(
        sampledPid: Int32?, ownPid: Int32, ordered: [PlacedWindow], displays: [DisplayFrame], fallback: UInt32
    ) -> UInt32 {
        guard let window = frontmostWindow(sampledPid: sampledPid, ownPid: ownPid, ordered: ordered) else {
            return fallback
        }
        let centre = CGPoint(x: window.frame.midX, y: window.frame.midY)
        return displays.first { $0.frame.contains(centre) }?.id ?? fallback
    }
}

public enum PinFallback: String, Sendable {
    // The pinned display is gone; capture follows the browser again.
    case displayUnavailable = "display-unavailable"
}

// [DOMAIN] The person's choice of display: "follow my browser" (nil) or one pinned
// display, remembered between launches. A pinned display that disappears is
// dropped, never silently remapped, and the drop is reported exactly once.
@MainActor
public final class DisplayPin {
    private let prefs: ShellPrefs
    private var fallbackPending = false

    public init(prefs: ShellPrefs) { self.prefs = prefs }

    public var pinnedId: UInt32? { prefs.captureDisplay }

    // Pins `id` (nil: follow). False, changing nothing, when that display is not present.
    @discardableResult
    public func set(_ id: UInt32?, available: [UInt32]) -> Bool {
        if let id, !available.contains(id) { return false }
        prefs.captureDisplay = id
        fallbackPending = false
        return true
    }

    // The pinned display if it is present; otherwise the pin is dropped and reported.
    public func effective(available: [UInt32]) -> UInt32? {
        guard let id = prefs.captureDisplay else { return nil }
        if available.contains(id) { return id }
        prefs.captureDisplay = nil
        fallbackPending = true
        return nil
    }

    // What a page is told about the pin: the live pin, or null plus the one-time
    // fallback when its display is gone (exactly as a capture would say).
    public func snapshot(available: [UInt32]) -> (id: UInt32?, fallback: PinFallback?) {
        let id = effective(available: available)
        return (id, takeFallback())
    }

    // True once after a pin was dropped.
    public func takeFallback() -> PinFallback? {
        guard fallbackPending else { return nil }
        fallbackPending = false
        return .displayUnavailable
    }
}
