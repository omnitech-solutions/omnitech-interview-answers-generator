import CoreGraphics
import Foundation

// [DOMAIN] The four translucent panels laid over the person's working window,
// and the pure maths that places them. AppKit coordinates throughout (origin
// bottom-left); `area` is a display's visible frame.
public enum PanelKind: String, CaseIterable, Sendable {
    case pill, analysis, chat, settings

    public var title: String {
        switch self {
        case .pill: "Status pill"
        case .analysis: "Analysis"
        case .chat: "Live transcription & chat"
        case .settings: "Settings"
        }
    }

    // The value of `?panel=` on the overlay route.
    public var queryName: String { rawValue }

    // The video's sizes: bar ~520x35, analysis ~700x400, chat ~320x440, settings ~400x380.
    public var defaultSize: CGSize {
        switch self {
        case .pill: CGSize(width: 520, height: 35)
        case .analysis: CGSize(width: 700, height: 400)
        case .chat: CGSize(width: 320, height: 440)
        case .settings: CGSize(width: 400, height: 380)
        }
    }

    public var minSize: CGSize {
        switch self {
        case .pill: CGSize(width: 520, height: 35)
        case .analysis: CGSize(width: 320, height: 200)
        case .chat: CGSize(width: 260, height: 200)
        case .settings: CGSize(width: 320, height: 240)
        }
    }

    public var isResizable: Bool { self != .pill }
    public var startsVisible: Bool { self != .settings }
}

public enum PanelLayout {
    public static let margin = 24.0
    public static let gap = 12.0
    public static let topInset = 8.0
    public static let step = 40.0

    // The video's layout: the bar top-centre of the display, the chat at the
    // left under it, the analysis right of the chat, settings top-right (on
    // demand). Every frame fits inside `area`.
    public static func defaultFrame(_ kind: PanelKind, in area: CGRect) -> CGRect {
        let pill = size(.pill, in: area)
        let pillFrame = CGRect(
            x: area.midX - pill.width / 2, y: area.maxY - topInset - pill.height,
            width: pill.width, height: pill.height)
        let top = pillFrame.minY - gap
        let chatSize = CGSize(
            width: min(PanelKind.chat.defaultSize.width, max(PanelKind.chat.minSize.width, area.width * 0.4)),
            height: min(PanelKind.chat.defaultSize.height, max(PanelKind.chat.minSize.height, top - area.minY - margin)))
        let chatFrame = CGRect(x: area.minX + margin, y: top - chatSize.height, width: chatSize.width, height: chatSize.height)
        switch kind {
        case .pill:
            return fit(pillFrame, in: area, min: kind.minSize)
        case .chat:
            return fit(chatFrame, in: area, min: kind.minSize)
        case .analysis:
            let left = chatFrame.maxX + gap
            let width = min(kind.defaultSize.width, max(kind.minSize.width, area.maxX - margin - left))
            let height = min(kind.defaultSize.height, max(kind.minSize.height, top - area.minY - margin))
            return fit(CGRect(x: left, y: top - height, width: width, height: height), in: area, min: kind.minSize)
        case .settings:
            let s = size(kind, in: area)
            return fit(CGRect(x: area.maxX - margin - s.width, y: area.maxY - topInset - s.height, width: s.width, height: s.height), in: area, min: kind.minSize)
        }
    }

    private static func size(_ kind: PanelKind, in area: CGRect) -> CGSize {
        CGSize(width: min(kind.defaultSize.width, area.width), height: min(kind.defaultSize.height, area.height))
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

    public static func nudge(_ frame: CGRect, dx: Double, dy: Double, in area: CGRect, min minimum: CGSize) -> CGRect {
        fit(frame.offsetBy(dx: dx, dy: dy), in: area, min: minimum)
    }

    // The top-left corner stays put while the size changes.
    public static func resize(_ frame: CGRect, dw: Double, dh: Double, in area: CGRect, min minimum: CGSize) -> CGRect {
        let width = Swift.max(minimum.width, frame.width + dw)
        let height = Swift.max(minimum.height, frame.height + dh)
        return fit(CGRect(x: frame.minX, y: frame.maxY - height, width: width, height: height), in: area, min: minimum)
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

    // [GUARD] At least a grabbable strip of the frame must lie on some display,
    // and it must respect the panel's minimum size; a fixed-size panel takes
    // only the saved origin.
    public static func restore(_ kind: PanelKind, saved: String?, displays: [CGRect]) -> CGRect? {
        restoreFrame(saved, minSize: kind.minSize, fixedSize: kind.isResizable ? nil : kind.defaultSize, displays: displays)
    }

    public static func restoreFrame(_ saved: String?, minSize: CGSize, fixedSize: CGSize?, displays: [CGRect]) -> CGRect? {
        guard let saved, var frame = decode(saved) else { return nil }
        if let fixedSize {
            frame.size = fixedSize
        } else {
            guard frame.width >= minSize.width, frame.height >= minSize.height else { return nil }
        }
        let strip = CGRect(x: frame.minX, y: frame.maxY - 28, width: frame.width, height: 28)
        let reachable = displays.contains { area in
            let overlap = area.intersection(strip)
            return !overlap.isNull && overlap.width >= 60 && overlap.height >= 20
        }
        return reachable ? frame : nil
    }
}

// [SAFETY] How a panel sits in the window server, platform-neutral; the AppKit
// adapter maps it onto NSPanel. Over any app and any Space, including a
// full-screen window: floating (the pill one tier up, at status-bar level),
// joins every Space, is a full-screen auxiliary, stays put through Mission
// Control, never hides when another app is active, never takes activation.
// There is deliberately NO sharing/capture-exclusion trait: panels keep the
// default and show in screen shares (ADR-0018, ADR-0019/shell-no-concealment).
public struct PanelWindowTraits: Equatable, Sendable {
    public enum LevelTier: Int, Sendable { case normal = 0, floating = 1, statusBar = 2 }

    public let level: LevelTier
    public let joinsAllSpaces = true
    public let fullScreenAuxiliary = true
    public let stationary = true
    public let hidesOnDeactivate = false
    public let nonActivating = true
    public let borderless = true

    public static func of(_ kind: PanelKind, pinned: Bool = true) -> PanelWindowTraits {
        PanelWindowTraits(level: pinned ? (kind == .pill ? .statusBar : .floating) : .normal)
    }
}
