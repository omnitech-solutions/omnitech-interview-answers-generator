import AppKit
import CaptureCore
import CoreGraphics
import CaptureAdapters
import ScreenCaptureKit
import StudioShellCore

// [DOMAIN] The ScreenWatch sampler: one tiny grey frame per tick of the
// frontmost non-shell app's focused window (re-sampled every tick, so a new tab
// or window is noticed even when the window id changes) or of the normalised
// region of the display. [SAFETY] Never the shell's own windows; the frame is
// drawn straight into a 9x8 grey grid and released: nothing is stored, sent or
// logged.
@MainActor
final class ShellScreenSampler: ScreenWatchSampler {
    private let capture: ShellCapture
    private let ownPid = ProcessInfo.processInfo.processIdentifier

    init(capture: ShellCapture) { self.capture = capture }

    func sample(_ request: ScreenWatchRequest) async -> ScreenWatchSample {
        guard CGPreflightScreenCaptureAccess() else { return .permissionDenied }
        let focus = capture.sample()
        let frontId = focus.focusedPid.flatMap { NSRunningApplication(processIdentifier: $0)?.bundleIdentifier }
        // [SAFETY] Only a browser in front is looked at.
        guard BrowserFocus.allows(bundleId: frontId) else { return .noWindow }
        guard let content = try? await ShareableContent.current(excludingDesktopWindows: false, onScreenWindowsOnly: true)
        else { return .noWindow }
        let filter: SCContentFilter
        let configuration = SCStreamConfiguration()
        switch request.mode {
        case .focusedWindow:
            let candidates = content.windows.map {
                WindowCandidate(
                    ownerPid: $0.owningApplication?.processID ?? -1, layer: $0.windowLayer,
                    isOnScreen: $0.isOnScreen, width: $0.frame.width, height: $0.frame.height)
            }
            guard let index = FocusSampling.choose(sampledPid: focus.focusedPid, ownPid: ownPid, windows: candidates)
            else { return .noWindow }
            filter = SCContentFilter(desktopIndependentWindow: content.windows[index])
        case .region:
            // A region defined for another display is never remapped.
            let current = UInt32(CGMainDisplayID())
            if let wanted = request.displayId, wanted != current { return .displayChanged }
            guard let display = content.displays.first(where: { $0.displayID == current }), let region = request.region
            else { return .displayChanged }
            let own = content.windows.filter { $0.owningApplication?.processID == ownPid }
            filter = SCContentFilter(display: display, excludingWindows: own)
            let whole = filter.contentRect.size
            configuration.sourceRect = CGRect(
                x: region.x * whole.width, y: region.y * whole.height,
                width: region.width * whole.width, height: region.height * whole.height)
        }
        configuration.width = 144
        configuration.height = 128
        configuration.showsCursor = false
        configuration.queueDepth = 1
        guard let image = await ShareableContent.screenshot(filter: filter, configuration: configuration)
        else { return .noWindow }
        return Self.grid(image).map(ScreenWatchSample.grid) ?? .noWindow
    }

    // Draws the frame into a 9x8 DeviceGray context (area-averaging downscale).
    private static func grid(_ image: CGImage) -> [UInt8]? {
        autoreleasepool {
            var pixels = [UInt8](repeating: 0, count: 72)
            let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
                guard let context = CGContext(
                    data: buffer.baseAddress, width: 9, height: 8, bitsPerComponent: 8, bytesPerRow: 9,
                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
                else { return false }
                context.interpolationQuality = .high
                context.draw(image, in: CGRect(x: 0, y: 0, width: 9, height: 8))
                return true
            }
            return drawn ? pixels : nil
        }
    }
}
