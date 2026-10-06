import CoreGraphics
import Foundation

// [DOMAIN] The two floating windows the shell owns besides the main Studio
// window: the one compact window (toolbar, chat, answer and code together) and
// the small Settings window beside it. AppKit coordinates throughout (origin
// bottom-left); `area` is a display's visible frame.
public enum WindowKind: String, CaseIterable, Sendable {
    case compact, settings

    // The value of `?panel=` on the overlay route: the page decides what to draw.
    public var queryName: String { self == .compact ? "single" : "settings" }

    // The toolbar (window controls, mode, microphone, domain, the tool buttons and
    // the account control) is as wide as its items and never clipped, so the
    // compact window is never narrower than it: 744pt measured in the page plus
    // the window's side gutters.
    public static let toolbarWidth = 760.0

    public var defaultSize: CGSize {
        switch self {
        case .compact: CGSize(width: 800, height: 640)
        case .settings: CGSize(width: 400, height: 380)
        }
    }

    public var minSize: CGSize {
        switch self {
        case .compact: CGSize(width: Self.toolbarWidth, height: 360)
        case .settings: CGSize(width: 320, height: 240)
        }
    }
}

public enum PanelLayout {
    public static let margin = 24.0
    public static let topInset = 8.0

    // The compact window sits at the bottom-right of the display; Settings opens
    // top-right. Every frame fits inside `area`.
    public static func defaultFrame(_ kind: WindowKind, in area: CGRect) -> CGRect {
        let size = kind.defaultSize
        let frame: CGRect
        switch kind {
        case .compact:
            frame = CGRect(x: area.maxX - margin - size.width, y: area.minY + margin, width: size.width, height: size.height)
        case .settings:
            frame = CGRect(x: area.maxX - margin - size.width, y: area.maxY - topInset - size.height, width: size.width, height: size.height)
        }
        return fit(frame, in: area, min: kind.minSize)
    }

    // Keeps a frame wholly inside `area`, shrinking it first if it is larger
    // (never below `min`).
    public static func fit(_ frame: CGRect, in area: CGRect, min minimum: CGSize) -> CGRect {
        let width = max(min(frame.width, area.width), min(minimum.width, area.width))
        let height = max(min(frame.height, area.height), min(minimum.height, area.height))
        let x = Swift.min(Swift.max(frame.minX, area.minX), area.maxX - width)
        let y = Swift.min(Swift.max(frame.minY, area.minY), area.maxY - height)
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

// [DOMAIN] Full screen of the one window: it fills the display's visible frame
// (menu bar and Dock stay, no macOS Space) and remembers the frame it left so
// turning it off, or any other size change, puts it back. Entering twice keeps
// the first remembered frame. Both frames pass through `PanelLayout.fit`, so the
// window is never off-screen.
public struct FullScreenFrame: Equatable, Sendable {
    public private(set) var remembered: CGRect?

    public init() {}

    public var isOn: Bool { remembered != nil }

    public mutating func enter(from current: CGRect, visible: CGRect, min minimum: CGSize) -> CGRect {
        if remembered == nil { remembered = current }
        return PanelLayout.fit(visible, in: visible, min: minimum)
    }

    // The frame to go back to, clamped onto the display it is on now (no minimum:
    // the window may have been fitted below its resize minimum, as the bare
    // toolbar is), or nil when full screen was not on.
    public mutating func leave(in area: CGRect) -> CGRect? {
        defer { remembered = nil }
        return remembered.map { PanelLayout.fit($0, in: area, min: .zero) }
    }
}

// [DOMAIN] Saved frames are stored as "x,y,w,h" and only restored when they are
// sane and still reachable on a connected display; otherwise the default wins.
public enum PanelFrameCodec {
    public static func encode(_ frame: CGRect) -> String {
        [frame.minX, frame.minY, frame.width, frame.height].map { String(Int($0.rounded())) }.joined(separator: ",")
    }

    public static func decode(_ text: String) -> CGRect? {
        let parts = text.split(separator: ",", omittingEmptySubsequences: false).compactMap { Double($0) }
        guard parts.count == 4, text.split(separator: ",").count == 4, parts.allSatisfy({ $0.isFinite }),
            parts.allSatisfy({ abs($0) < 100_000 }), parts[2] > 0, parts[3] > 0
        else { return nil }
        return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    }

    // [GUARD] A window is never lost off-screen: at least a grabbable strip of the
    // frame must lie on some display, and it must respect the minimum size.
    public static func restoreFrame(_ saved: String?, minSize: CGSize, displays: [CGRect]) -> CGRect? {
        guard let saved, let frame = decode(saved),
            frame.width >= minSize.width, frame.height >= minSize.height
        else { return nil }
        let strip = CGRect(x: frame.minX, y: frame.maxY - 28, width: frame.width, height: 28)
        let reachable = displays.contains { area in
            let overlap = area.intersection(strip)
            return !overlap.isNull && overlap.width >= 60 && overlap.height >= 20
        }
        return reachable ? frame : nil
    }
}

// [SAFETY] How a floating window sits in the window server, platform-neutral; the
// AppKit adapter maps it onto NSPanel. Over any app and any Space, including a
// full-screen window: floating when pinned, joins every Space, is a full-screen
// auxiliary, stays put through Mission Control, never hides when another app is
// active, never takes activation. There is deliberately NO sharing/capture-exclusion
// trait: windows keep the default and show in screen shares (ADR-0018,
// ADR-0019/shell-no-concealment).
public struct PanelWindowTraits: Equatable, Sendable {
    public enum LevelTier: Int, Sendable { case normal = 0, floating = 1 }

    public let level: LevelTier
    public let joinsAllSpaces = true
    public let fullScreenAuxiliary = true
    public let stationary = true
    public let hidesOnDeactivate = false
    public let nonActivating = true
    public let borderless = true

    public static func of(pinned: Bool = true) -> PanelWindowTraits {
        PanelWindowTraits(level: pinned ? .floating : .normal)
    }
}

// [DOMAIN] A press on a floating window makes Interview Studio the active app, so
// its name and menus (File, Edit, View, Window) show in the menu bar and in
// Cmd-Tab, as for any app you are using. Hovering, dragging a window that is
// already in front of an active app, and clicks that pass through clear glass do
// not. Capture is unaffected: "focused window" is the last other application
// (FocusSampling), sampled before the panel can take focus.
public enum PanelActivation {
    public static func shouldActivate(pressed: Bool, appIsActive: Bool) -> Bool {
        pressed && !appIsActive
    }
}
