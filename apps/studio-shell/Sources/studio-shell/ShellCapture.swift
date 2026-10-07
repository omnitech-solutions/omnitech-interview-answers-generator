import AppKit
import CaptureCore
import CoreGraphics
import Foundation
import ImageIO
import CaptureAdapters
import ScreenCaptureKit
import StudioShellCore
import UniformTypeIdentifiers

// [DOMAIN] The shell's one-shot capture for a page request (ADR-0018, 0019).
// It is the shell's own rather than the companion's ScreenKitOneShot because
// the shell must (1) sample the frontmost application when the request is
// received, never itself, and (2) bind a region to the display it was defined
// for. Decisions live in StudioShellCore (FocusSampling, DisplayBinding).
// [SAFETY] A region is cropped before encoding, so pixels outside it never
// leave this function. Nothing here credentials, sends or logs anything.
@MainActor
final class ShellCapture {
    // What was true when the request arrived.
    struct Sample {
        let focusedPid: Int32?
        // The display this capture comes from: the pinned one, else the one holding
        // the sampled browser's frontmost window, else the main display.
        let displayId: CGDirectDisplayID
        let pinned: Bool
        // [SAFETY] The sampled browser's on-screen windows at receipt, and the ONLY windows a
        // display or region capture may render (empty exactly when focusedPid is nil).
        let windowIds: [UInt32]
        // The application the policy found no browser to replace, by name only: what the
        // person was in front of when no browser could be captured. nil when a browser was chosen.
        let frontAppName: String?
    }

    struct Result {
        let outcome: CaptureOutcome
        let displayId: UInt32
        // The frame's on-device text, when recognition finished within its budget.
        var ocr: OcrText?
        var display: DisplayInfo?
        var pinned = false
        var pinFallback: PinFallback?
    }

    // Shared with the recognizeText bridge op: one recognizer, one budget policy.
    let recognizer = TextRecognizer(observer: VisionTextObserver())
    // Recognition rides on a capture, so it may never hold the frame for long.
    static let captureOcrBudget: Duration = .seconds(4)

    // The person's display choice (follow the browser, or one pinned display).
    let pin = DisplayPin(prefs: ShellPrefs(store: UserDefaultsStore()))
    private let ownPid = ProcessInfo.processInfo.processIdentifier
    private var lastOther: Int32?
    // The last browser (Chrome or Safari) that was in front, for the person's own
    // captures when another app has focus now (CaptureTargetPolicy).
    private var lastBrowser: Int32?
    private var observer: NSObjectProtocol?

    init() {
        lastOther = Self.otherFrontmost(ownPid)
        lastBrowser = lastOther.flatMap { Self.isBrowser($0) ? $0 : nil }
        // An activation of any other application is the last "focused" one
        // the shell can fall back on if it is itself frontmost at receipt.
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated {
                guard let self, let pid, pid != self.ownPid else { return }
                self.lastOther = pid
                if Self.isBrowser(pid) { self.lastBrowser = pid }
            }
        }
    }

    private static func otherFrontmost(_ own: Int32) -> Int32? {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier, pid != own else { return nil }
        return pid
    }

    private static func isBrowser(_ pid: Int32) -> Bool {
        BrowserFocus.allows(bundleId: NSRunningApplication(processIdentifier: pid)?.bundleIdentifier)
    }

    // Called synchronously on receipt, before any await. `focusedPid` is nil when the
    // policy found no browser to look at (the capture then answers no-focused-window).
    func sample(intent: CaptureIntent) -> Sample {
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let chosen = CaptureTargetPolicy.decide(
            intent: intent, frontmost: frontmost, ownPid: ownPid, lastOther: lastOther, lastBrowser: lastBrowser,
            isBrowser: Self.isBrowser)
        // [SAFETY] A browser with no ON-SCREEN window (hidden, minimised, another Space; or none on
        // the pinned display) is no target: the capture is refused rather than widened to a display.
        let infos = Displays.infos()
        let pinnedId = pin.effective(available: infos.map(\.id))
        let pinnedFrame = pinnedId.flatMap { id in Displays.frames(of: infos).first { $0.id == id } }
        let ordered = Displays.windows(ofPid: chosen)
        let windowIds = CaptureTarget.browserWindowIds(
            sampledPid: chosen, ownPid: ownPid, ordered: ordered, on: pinnedFrame)
        let pid = windowIds.isEmpty ? nil : chosen
        let (id, pinned) = resolveDisplay(sampledPid: pid)
        // What was in front instead (never the shell itself): its name only, for the page's message.
        let front = pid == nil ? FocusSampling.sample(frontmost: frontmost, ownPid: ownPid, lastOther: lastOther) : nil
        let name = front.flatMap { NSRunningApplication(processIdentifier: $0)?.localizedName }
        return Sample(
            focusedPid: pid, displayId: id, pinned: pinned, windowIds: windowIds,
            frontAppName: FrontAppName.sanitize(name))
    }

    // Pinned display, else where the sampled browser's frontmost window is, else main.
    private func resolveDisplay(sampledPid: Int32?) -> (id: CGDirectDisplayID, pinned: Bool) {
        let infos = Displays.infos()
        if let pinned = pin.effective(available: infos.map(\.id)) { return (pinned, true) }
        let id = CaptureTarget.display(
            sampledPid: sampledPid, ownPid: ownPid, ordered: Displays.windows(ofPid: sampledPid),
            displays: Displays.frames(of: infos), fallback: UInt32(CGMainDisplayID()))
        return (id, false)
    }

    // The display a frame came from, for the page's indicator.
    func info(_ id: CGDirectDisplayID) -> DisplayInfo? { Displays.infos().first { $0.id == UInt32(id) } }

    // The sampled app's frontmost qualifying window (on the pinned display, when pinned).
    func window(in windows: [SCWindow], for sample: Sample) -> SCWindow? {
        let frame =
            sample.pinned ? Displays.frames(of: Displays.infos()).first { $0.id == UInt32(sample.displayId) } : nil
        guard !(sample.pinned && frame == nil),
            let chosen = CaptureTarget.frontmostWindow(
                sampledPid: sample.focusedPid, ownPid: ownPid, ordered: Displays.windows(ofPid: sample.focusedPid),
                on: frame)
        else { return nil }
        return windows.first { $0.windowID == chosen.windowId }
    }

    // The sampled browser's windows as ScreenCaptureKit lists them (never the shell's own).
    static func browserWindows(in windows: [SCWindow], ids: [UInt32]) -> [SCWindow] {
        let wanted = Set(ids)
        return windows.filter { wanted.contains($0.windowID) }
    }

    func capture(_ request: CaptureRequest, displayId requested: UInt32?, sample: Sample) async -> Result {
        let id = UInt32(sample.displayId)
        func lost(_ loss: CaptureLoss) -> Result { Result(outcome: .lost(loss), displayId: id) }

        // [GUARD] A region defined for another display is refused, not remapped; so is
        // one whose display changed (the browser moved, the pin changed) since receipt.
        if request.mode == .region,
            !DisplayBinding.allows(
                requested: requested, sampled: id, current: UInt32(resolveDisplay(sampledPid: sample.focusedPid).id))
        {
            return lost(.captureFailed)
        }
        guard CGPreflightScreenCaptureAccess(),
            let content = try? await ShareableContent.current(excludingDesktopWindows: false, onScreenWindowsOnly: true)
        else { return lost(.captureFailed) }

        let filter: SCContentFilter
        let label: String
        switch request.mode {
        case .focusedWindow:
            guard let window = window(in: content.windows, for: sample) else { return lost(.noFocusedWindow) }
            filter = SCContentFilter(desktopIndependentWindow: window)
            label = window.owningApplication?.applicationName ?? "window"
        case .display, .region:
            // The display resolved at receipt, not whatever it is by now.
            guard let display = content.displays.first(where: { $0.displayID == sample.displayId }),
                request.mode == .display
                    || DisplayBinding.allows(
                        requested: requested, sampled: id,
                        current: UInt32(resolveDisplay(sampledPid: sample.focusedPid).id))
            else { return lost(.captureFailed) }
            // [SAFETY] Only the browser's windows are rendered (never the whole display minus the
            // shell): another app in front of the browser cannot reach the JPEG or the OCR text.
            let browser = Self.browserWindows(in: content.windows, ids: sample.windowIds)
            guard !browser.isEmpty else { return lost(.noFocusedWindow) }
            filter = SCContentFilter(display: display, including: browser)
            label = "display"
        }

        // [SAFETY] A region is cropped by the capture itself (sourceRect), so pixels
        // outside it are never even rendered; the frame is capped to a small
        // long edge so repeated captures stay light.
        let scale = CGFloat(filter.pointPixelScale)
        let configuration = SCStreamConfiguration()
        var pointSize = filter.contentRect.size
        if request.mode == .region {
            guard let region = request.region else { return lost(.captureFailed) }
            let whole = filter.contentRect.size
            let rect = CGRect(
                x: region.x * whole.width, y: region.y * whole.height,
                width: region.width * whole.width, height: region.height * whole.height)
            configuration.sourceRect = rect
            pointSize = rect.size
        }
        let fitted = FrameSize.fit(
            width: Int((pointSize.width * scale).rounded()), height: Int((pointSize.height * scale).rounded()))
        configuration.width = fitted.width
        configuration.height = fitted.height
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.queueDepth = 1
        guard let image = await ShareableContent.screenshot(filter: filter, configuration: configuration)
        else { return lost(.captureFailed) }

        guard
            let jpeg = autoreleasepool(invoking: { Self.jpeg(image, maxBytes: ActiveSessionLimits.maxScreenshotBytes) })
        else {
            return lost(.captureFailed)
        }
        return Result(
            outcome: .image(jpeg: jpeg, windowLabel: label), displayId: id,
            display: info(sample.displayId), pinned: sample.pinned, pinFallback: pin.takeFallback())
    }

    // One small preview per display, for the owner's picker only: the shell's own windows
    // are excluded, and nothing is stored, sent or logged. Nil when capture is unavailable.
    func previews() async -> [(display: DisplayInfo, jpeg: Data)]? {
        guard CGPreflightScreenCaptureAccess(),
            let content = try? await ShareableContent.current(excludingDesktopWindows: false, onScreenWindowsOnly: true)
        else { return nil }
        let own = content.windows.filter { $0.owningApplication?.processID == ownPid }
        var previews: [(display: DisplayInfo, jpeg: Data)] = []
        for info in Displays.infos() {
            guard let display = content.displays.first(where: { $0.displayID == info.id }) else { continue }
            let configuration = SCStreamConfiguration()
            let size = FrameSize.fit(
                width: Int(display.width), height: Int(display.height), maxLongEdge: Self.previewLongEdge)
            configuration.width = size.width
            configuration.height = size.height
            configuration.showsCursor = false
            configuration.queueDepth = 1
            guard
                let image = await ShareableContent.screenshot(
                    filter: SCContentFilter(display: display, excludingWindows: own), configuration: configuration),
                let jpeg = autoreleasepool(invoking: {
                    Self.jpeg(image, maxBytes: ActiveSessionLimits.maxScreenshotBytes)
                })
            else { continue }
            previews.append((info, jpeg))
        }
        return previews
    }
    static let previewLongEdge = 320

    // Lowers quality, then size, until the frame fits the cap.
    private static func jpeg(_ image: CGImage, maxBytes: Int) -> Data? {
        var current = image
        for _ in 0..<3 {
            for quality in [0.7, 0.5, 0.35] {
                if let data = encode(current, quality: quality), data.count <= maxBytes { return data }
            }
            let width = max(1, current.width / 2), height = max(1, current.height / 2)
            guard
                let context = CGContext(
                    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
            else { return nil }
            context.interpolationQuality = .high
            context.draw(current, in: CGRect(x: 0, y: 0, width: width, height: height))
            guard let smaller = context.makeImage() else { return nil }
            current = smaller
        }
        return nil
    }

    private static func encode(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
