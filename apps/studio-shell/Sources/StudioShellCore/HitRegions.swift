import CoreGraphics
import Foundation

// [DOMAIN] See-through click-through, by region. The page reports the rectangles
// of every surface it paints or lets the person use (toolbar, strip, panes,
// footer, menus, toasts, the image viewer); the window takes the mouse over them
// and passes it to the app underneath everywhere else. The shell never decides
// what is a surface: it only answers "is this point inside a reported rectangle".
// The wire shape mirrors `packages/interview-contracts` (`HitRegion`,
// `HIT_REGION_LIMITS`). Pure: no AppKit, so each rule is a test.

// One rectangle in the window's content, CSS px (= points) from its top-left.
public struct HitRect: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum HitRegions {
    // [GUARD] The bounds of one report; the TypeScript contract states the same numbers.
    public static let maxRects = 64
    public static let maxSide = 20000.0
    // The shell trusts a report only this long: the page repeats it while it wants
    // pass-through, and when reports stop (a reload, a crash, a hung page) the
    // window is interactive again rather than inert.
    public static let staleAfter: TimeInterval = 15

    // [GUARD] Everything the page sends is untrusted. `null` means no masking (the
    // whole window is interactive); an array is at most `maxRects` rectangles, each
    // exactly {x, y, width, height} of finite numbers with width and height above 0
    // and at most `maxSide`, and an origin within `maxSide` of the corner. An empty
    // array is valid and means everything passes through.
    public static func decode(_ raw: Any?) -> Result<[HitRect]?, HostCallError> {
        guard let raw else { return .failure(.invalidParameters) }
        if raw is NSNull { return .success(nil) }
        guard let list = raw as? [Any], list.count <= maxRects else { return .failure(.invalidParameters) }
        var rects: [HitRect] = []
        rects.reserveCapacity(list.count)
        for item in list {
            guard let fields = item as? [String: Any], Set(fields.keys) == ["x", "y", "width", "height"],
                let x = number(fields["x"]), let y = number(fields["y"]),
                let width = number(fields["width"]), let height = number(fields["height"]),
                [x, y, width, height].allSatisfy({ $0.isFinite }),
                abs(x) <= maxSide, abs(y) <= maxSide,
                width > 0, width <= maxSide, height > 0, height <= maxSide
            else { return .failure(.invalidParameters) }
            rects.append(HitRect(x: x, y: y, width: width, height: height))
        }
        return .success(rects)
    }

    // JavaScript numbers arrive as NSNumber; Bool is an NSNumber too and is not a number here.
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
}

// [DOMAIN] Where a window sits for the decision: its frame on screen (AppKit:
// origin bottom-left, Y up) and the height of the native strip over the top of its
// page (the page's origin is below it).
public struct HitGeometry: Equatable, Sendable {
    public let windowFrame: CGRect
    public let topInset: Double

    public init(windowFrame: CGRect, topInset: Double) {
        self.windowFrame = windowFrame
        self.topInset = topInset
    }

    // The page's top-left CSS point for a point on screen (Y flipped, the strip
    // above the page removed).
    public func pagePoint(_ screen: CGPoint) -> CGPoint {
        CGPoint(x: screen.x - windowFrame.minX, y: (windowFrame.maxY - topInset) - screen.y)
    }

    // The page's own size: the window less the strip.
    public var pageSize: CGSize {
        CGSize(width: windowFrame.width, height: max(0, windowFrame.height - topInset))
    }
}

public enum HitTest {
    // The rectangles cut to the page, with any that end up empty dropped: a surface
    // hanging off the window's edge only counts where it is on the window.
    public static func clamped(_ rects: [HitRect], to size: CGSize) -> [HitRect] {
        rects.compactMap { rect in
            let minX = max(rect.x, 0), minY = max(rect.y, 0)
            let maxX = min(rect.x + rect.width, Double(size.width)),
                maxY = min(rect.y + rect.height, Double(size.height))
            guard maxX > minX, maxY > minY else { return nil }
            return HitRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
        }
    }

    // Whether the window should take the mouse at this screen point.
    // - `nil` regions: no masking, the whole window is interactive.
    // - a reported list: only the points inside one of its rectangles (edges
    //   included, so a tie goes to the person's click), plus the native strip over
    //   the top of the page, which drags the window. An empty list means every
    //   point passes through (the strip aside, which is empty at `topInset` 0).
    // A point outside the window is never "interactive": there is nothing to take.
    public static func isInteractive(at screen: CGPoint, in geometry: HitGeometry, regions: [HitRect]?) -> Bool {
        guard let regions else { return true }
        guard geometry.windowFrame.contains(screen) else { return false }
        let point = geometry.pagePoint(screen)
        if point.y < 0 { return true }
        return clamped(regions, to: geometry.pageSize).contains { rect in
            point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
        }
    }

    // What the window's `ignoresMouseEvents` should be at this point.
    public static func ignoresMouse(at screen: CGPoint, in geometry: HitGeometry, regions: [HitRect]?) -> Bool {
        !isInteractive(at: screen, in: geometry, regions: regions)
    }
}

// [DOMAIN] The last report and when it arrived. A report older than
// `HitRegions.staleAfter` is no report: the window falls back to interactive so it
// can never stay inert because the page stopped talking. Time is passed in, so the
// rule is a test.
public struct HitRegionLease: Equatable, Sendable {
    public private(set) var regions: [HitRect]?
    public private(set) var receivedAt: TimeInterval

    public init(regions: [HitRect]? = nil, receivedAt: TimeInterval = 0) {
        self.regions = regions
        self.receivedAt = receivedAt
    }

    public mutating func update(_ regions: [HitRect]?, now: TimeInterval) {
        self.regions = regions
        receivedAt = now
    }

    // The regions that may be used now; nil when there are none or they are stale.
    public func current(now: TimeInterval) -> [HitRect]? {
        guard let regions, now - receivedAt <= HitRegions.staleAfter else { return nil }
        return regions
    }

    public func ignoresMouse(at screen: CGPoint, in geometry: HitGeometry, now: TimeInterval) -> Bool {
        HitTest.ignoresMouse(at: screen, in: geometry, regions: current(now: now))
    }
}
