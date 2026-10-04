import Foundation

// [DOMAIN] Capture now (ADR-0016 follow-up). Studio hands the companion at most
// one pending request, only inside `control.capture` on an acknowledgement it
// already receives. The companion captures ONCE per request id and answers with
// a normal screenshot carrying that id. Nothing here can add a source: a request
// is honoured only while the screen source the person selected at start is
// running, and it names what to capture, never where to send it.

// What one capture-now request produced, from the adapter's point of view.
public enum CaptureLoss: String, Equatable, Sendable {
    // The frontmost application has no capturable window. Never widened to the display.
    case noFocusedWindow = "no-focused-window"
    case captureFailed = "capture-failed"
}

public enum CaptureOutcome: Equatable, Sendable {
    // JPEG bytes already under the size cap; the label is an application name only.
    case image(jpeg: Data, windowLabel: String)
    case lost(CaptureLoss)
}

public enum CaptureTake: Equatable, Sendable {
    case nothing
    case honour(CaptureRequest)
    // A request arrived while the screen source could not honour it (paused,
    // lost, revoked, refused or never selected); it is dropped visibly.
    case ignored
}

public enum CaptureCompletion: Equatable, Sendable {
    case submitted
    case lost(CaptureLoss)
    // The session stopped, paused or lost the screen while capturing: nothing is sent.
    case dropped
}

// Takes each request id once: a repeat on a later acknowledgement is ignored.
// The remembered ids are bounded so a long run holds no unbounded history.
public final class CaptureRequestInbox {
    private static let remembered = 32
    private var handled: [String] = []
    private var wanted: CaptureRequest?

    public init() {}

    public func offer(_ request: CaptureRequest?) {
        guard let request, !handled.contains(request.requestId) else { return }
        handled.append(request.requestId)
        if handled.count > Self.remembered { handled.removeFirst() }
        wanted = request
    }

    public func take() -> CaptureRequest? {
        defer { wanted = nil }
        return wanted
    }
}

// A pixel rectangle inside an image, origin top-left.
public struct PixelRect: Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum CaptureGeometry {
    // [SAFETY] A region is applied to the chosen display's own pixels, so pixels
    // outside it never leave the Mac. The rectangle is clamped inside the image
    // and is at least one pixel; an empty or non-finite region yields nil and
    // the caller reports a loss instead of sending the whole display.
    public static func cropRect(_ region: CaptureRegion, imageWidth: Int, imageHeight: Int) -> PixelRect? {
        guard imageWidth > 0, imageHeight > 0,
            [region.x, region.y, region.width, region.height].allSatisfy({ $0.isFinite }),
            region.x >= 0, region.y >= 0, region.width > 0, region.height > 0
        else { return nil }
        let left = min(Int((region.x * Double(imageWidth)).rounded(.down)), imageWidth - 1)
        let top = min(Int((region.y * Double(imageHeight)).rounded(.down)), imageHeight - 1)
        let right = min(Int(((region.x + region.width) * Double(imageWidth)).rounded(.up)), imageWidth)
        let bottom = min(Int(((region.y + region.height) * Double(imageHeight)).rounded(.up)), imageHeight)
        return PixelRect(x: left, y: top, width: max(1, right - left), height: max(1, bottom - top))
    }
}

// One on-screen window as the platform reports it, reduced to what choosing
// needs. No title: a title is content and never leaves the adapter.
public struct WindowCandidate: Equatable, Sendable {
    public let ownerPid: Int32
    public let layer: Int
    public let isOnScreen: Bool
    public let width: Double
    public let height: Double

    public init(ownerPid: Int32, layer: Int, isOnScreen: Bool, width: Double, height: Double) {
        self.ownerPid = ownerPid
        self.layer = layer
        self.isOnScreen = isOnScreen
        self.width = width
        self.height = height
    }
}

public enum FocusedWindow {
    // Overlays, tooltips and toolbars are small; a real document window is not.
    public static let minimumSide = 64.0

    // [SAFETY] The frontmost application's largest on-screen, layer-0 window.
    // No frontmost application, or none of its windows qualifying, is nil: the
    // caller reports "no focused window" and never widens to the display or to
    // another application's window.
    public static func choose(frontmostPid: Int32?, windows: [WindowCandidate]) -> Int? {
        guard let frontmostPid else { return nil }
        var best: (index: Int, area: Double)?
        for (index, window) in windows.enumerated()
        where window.ownerPid == frontmostPid && window.layer == 0 && window.isOnScreen
            && window.width >= minimumSide && window.height >= minimumSide
        {
            let area = window.width * window.height
            if best == nil || area > best!.area { best = (index, area) }
        }
        return best?.index
    }
}
