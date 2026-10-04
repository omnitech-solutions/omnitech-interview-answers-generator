import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

// [DOMAIN] The local `capture-companion windows` diagnostic: why did a named
// or focused window not match? Each row is the owning application's name, its
// layer, whether it is on screen, whether it belongs to the frontmost
// application, and the LENGTH of its title. [SAFETY] A title is content and is
// never read into a row, printed or sent; only its length is.
public struct WindowSummary: Sendable {
    public let applicationName: String
    public let layer: Int
    public let isOnScreen: Bool
    public let isFrontmostApplication: Bool
    public let titleLength: Int
}

public enum WindowDiagnostics {
    // Whether Screen Recording access is currently granted. It never prompts.
    public static func screenAccessGranted() -> Bool { CGPreflightScreenCaptureAccess() }

    // Every window ScreenCaptureKit can see, or nil when it cannot be asked
    // (usually because Screen Recording access is not granted).
    public static func listing() async -> [WindowSummary]? {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        else { return nil }
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return content.windows.map { window in
            WindowSummary(
                applicationName: window.owningApplication?.applicationName ?? "unknown",
                layer: window.windowLayer, isOnScreen: window.isOnScreen,
                isFrontmostApplication: window.owningApplication?.processID == frontmost,
                titleLength: window.title?.utf16.count ?? 0)
        }
    }
}
