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
    // The display the last sample came from, reported with a change event.
    private(set) var lastDisplay: DisplayInfo?

    init(capture: ShellCapture) { self.capture = capture }

    func sample(_ request: ScreenWatchRequest) async -> ScreenWatchSample {
        guard CGPreflightScreenCaptureAccess() else { return .permissionDenied }
        // [SAFETY] Auto looks only while a browser is in front: the policy answers nil otherwise.
        let focus = capture.sample(intent: .auto)
        guard focus.focusedPid != nil else { return .noWindow }
        guard let content = try? await ShareableContent.current(excludingDesktopWindows: false, onScreenWindowsOnly: true)
        else { return .noWindow }
        let filter: SCContentFilter
        let configuration = SCStreamConfiguration()
        switch request.mode {
        case .focusedWindow:
            guard let window = capture.window(in: content.windows, for: focus) else { return .noWindow }
            filter = SCContentFilter(desktopIndependentWindow: window)
        case .region:
            // A region defined for another display is never remapped.
            let current = UInt32(focus.displayId)
            if let wanted = request.displayId, wanted != current { return .displayChanged }
            guard let display = content.displays.first(where: { $0.displayID == current }), let region = request.region
            else { return .displayChanged }
            // [SAFETY] Only the browser's windows are rendered, exactly as an explicit capture.
            let browser = ShellCapture.browserWindows(in: content.windows, ids: focus.windowIds)
            guard !browser.isEmpty else { return .noWindow }
            filter = SCContentFilter(display: display, including: browser)
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
        lastDisplay = capture.info(focus.displayId)
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
