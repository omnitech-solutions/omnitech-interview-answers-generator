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
        let displayId: CGDirectDisplayID
    }

    struct Result {
        let outcome: CaptureOutcome
        let displayId: UInt32
    }

    private let ownPid = ProcessInfo.processInfo.processIdentifier
    private var lastOther: Int32?
    private var observer: NSObjectProtocol?

    init() {
        lastOther = Self.otherFrontmost(ownPid)
        // An activation of any other application is the last "focused" one
        // the shell can fall back on if it is itself frontmost at receipt.
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated {
                guard let self, let pid, pid != self.ownPid else { return }
                self.lastOther = pid
            }
        }
    }

    private static func otherFrontmost(_ own: Int32) -> Int32? {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier, pid != own else { return nil }
        return pid
    }

    // Called synchronously on receipt, before any await.
    func sample() -> Sample {
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return Sample(
            focusedPid: FocusSampling.sample(frontmost: frontmost, ownPid: ownPid, lastOther: lastOther),
            displayId: CGMainDisplayID())
    }

    func capture(_ request: CaptureRequest, displayId requested: UInt32?, sample: Sample) async -> Result {
        let id = UInt32(sample.displayId)
        func lost(_ loss: CaptureLoss) -> Result { Result(outcome: .lost(loss), displayId: id) }

        // [GUARD] A region defined for another display is refused, not remapped.
        if request.mode == .region,
            !DisplayBinding.allows(requested: requested, sampled: id, current: UInt32(CGMainDisplayID()))
        { return lost(.captureFailed) }
        guard CGPreflightScreenCaptureAccess(),
            let content = try? await ShareableContent.current(excludingDesktopWindows: false, onScreenWindowsOnly: true)
        else { return lost(.captureFailed) }

        let filter: SCContentFilter
        let label: String
        switch request.mode {
        case .focusedWindow:
            let candidates = content.windows.map {
                WindowCandidate(
                    ownerPid: $0.owningApplication?.processID ?? -1, layer: $0.windowLayer,
                    isOnScreen: $0.isOnScreen, width: $0.frame.width, height: $0.frame.height)
            }
            guard let index = FocusSampling.choose(sampledPid: sample.focusedPid, ownPid: ownPid, windows: candidates)
            else { return lost(.noFocusedWindow) }
            let window = content.windows[index]
            filter = SCContentFilter(desktopIndependentWindow: window)
            label = window.owningApplication?.applicationName ?? "window"
        case .display, .region:
            // The display sampled at receipt, not whichever is main by now.
            guard let display = content.displays.first(where: { $0.displayID == sample.displayId }),
                request.mode == .display || DisplayBinding.allows(
                    requested: requested, sampled: id, current: UInt32(CGMainDisplayID()))
            else { return lost(.captureFailed) }
            let own = content.windows.filter { $0.owningApplication?.processID == ownPid }
            filter = SCContentFilter(display: display, excludingWindows: own)
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
        let fitted = FrameSize.fit(width: Int((pointSize.width * scale).rounded()), height: Int((pointSize.height * scale).rounded()))
        configuration.width = fitted.width
        configuration.height = fitted.height
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.queueDepth = 1
        guard let image = await ShareableContent.screenshot(filter: filter, configuration: configuration)
        else { return lost(.captureFailed) }

        guard let jpeg = autoreleasepool(invoking: { Self.jpeg(image, maxBytes: ActiveSessionLimits.maxScreenshotBytes) }) else {
            return lost(.captureFailed)
        }
        return Result(outcome: .image(jpeg: jpeg, windowLabel: label), displayId: id)
    }

    // Lowers quality, then size, until the frame fits the cap.
    private static func jpeg(_ image: CGImage, maxBytes: Int) -> Data? {
        var current = image
        for _ in 0..<3 {
            for quality in [0.7, 0.5, 0.35] {
                if let data = encode(current, quality: quality), data.count <= maxBytes { return data }
            }
            let width = max(1, current.width / 2), height = max(1, current.height / 2)
            guard let context = CGContext(
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
