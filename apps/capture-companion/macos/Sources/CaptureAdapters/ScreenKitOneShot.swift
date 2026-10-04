import AppKit
import CaptureCore
import CoreGraphics
import Foundation
import ScreenCaptureKit

// [DOMAIN] Capture now: ONE image for ONE request Studio handed over (see
// CaptureRequests.swift in Core). It uses ScreenCaptureKit's still-image API
// (macOS 14+, the package's floor), so no stream is started and no frame is
// kept. Three modes:
//   focused-window  the largest on-screen layer-0 window of the application that was
//                   frontmost when the request was TAKEN (FocusSample), not at capture time
//   region          a normalised rectangle of the MAIN display, cropped here
//   display         the main display
// [SAFETY] A focused window that cannot be found is a visible loss, never the
// whole display. A region is cropped before encoding, so pixels outside it
// never leave this Mac. The label is the application name only, never a title.
public enum ScreenKitOneShot {
    // The frontmost application now; the session samples it when a request is taken.
    public static func sampleFocus() -> FocusSample {
        FocusSample(frontmostPid: NSWorkspace.shared.frontmostApplication?.processIdentifier)
    }

    public static func capture(_ request: CaptureRequest, focus: FocusSample) async -> CaptureOutcome {
        // Never prompt from a one-shot: the screen source was selected (and
        // authorised) at start; a revoked grant is a loss, reported as such.
        guard CGPreflightScreenCaptureAccess() else { return .lost(.permissionDenied) }
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            return .lost(.captureFailed)
        }

        let filter: SCContentFilter
        let label: String
        switch request.mode {
        case .focusedWindow:
            let candidates = content.windows.map(Self.candidate)
            guard let index = FocusedWindow.choose(frontmostPid: focus.frontmostPid, windows: candidates) else {
                return .lost(.noFocusedWindow)
            }
            let window = content.windows[index]
            filter = SCContentFilter(desktopIndependentWindow: window)
            label = window.owningApplication?.applicationName ?? "window"
        case .display, .region:
            guard let display = Self.mainDisplay(content) else { return .lost(.captureFailed) }
            filter = SCContentFilter(display: display, excludingWindows: [])
            label = "display"
        }

        let scale = CGFloat(filter.pointPixelScale)
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int((filter.contentRect.width * scale).rounded()))
        configuration.height = max(1, Int((filter.contentRect.height * scale).rounded()))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true

        guard var image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        else { return .lost(.captureFailed) }

        if request.mode == .region {
            guard let region = request.region,
                let rect = CaptureGeometry.cropRect(region, imageWidth: image.width, imageHeight: image.height),
                let cropped = image.cropping(to: CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height))
            else { return .lost(.captureFailed) }
            image = cropped
        }
        guard let jpeg = ImageEncoder.jpeg(image, maxBytes: ActiveSessionLimits.maxScreenshotBytes) else {
            return .lost(.captureFailed)
        }
        return .image(jpeg: jpeg, windowLabel: label)
    }

    // The main display by its CoreGraphics id, falling back to the first one.
    private static func mainDisplay(_ content: SCShareableContent) -> SCDisplay? {
        content.displays.first { $0.displayID == CGMainDisplayID() } ?? content.displays.first
    }

    private static func candidate(_ window: SCWindow) -> WindowCandidate {
        WindowCandidate(
            ownerPid: window.owningApplication?.processID ?? -1, layer: window.windowLayer,
            isOnScreen: window.isOnScreen, width: window.frame.width, height: window.frame.height)
    }
}
