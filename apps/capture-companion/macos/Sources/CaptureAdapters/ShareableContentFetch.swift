import CoreGraphics
import Foundation
import ScreenCaptureKit

// The one way this repository asks ScreenCaptureKit what is on screen.
//
// The async `SCShareableContent.excludingDesktopWindows` bridge crashed the shell
// (SIGBUS in swift_retain, inside the compiler-generated completion thunk) when
// Screen Recording had not been granted to the running build, which an ad-hoc
// signed rebuild always loses. So: never call it without the permission, and use
// the completion-handler form, handing the result across in an owned box.
public enum ShareableContent {
    public struct Unavailable: Error, Sendable {
        public let reason: String
    }

    private final class Box: @unchecked Sendable {
        let content: SCShareableContent
        init(_ content: SCShareableContent) { self.content = content }
    }

    /// True when this process may capture the screen. Never prompts.
    public static var permitted: Bool { CGPreflightScreenCaptureAccess() }

    public static func current(
        excludingDesktopWindows: Bool, onScreenWindowsOnly: Bool
    ) async throws -> SCShareableContent {
        guard permitted else { throw Unavailable(reason: "permission-denied") }
        let box: Box = try await withCheckedThrowingContinuation { continuation in
            SCShareableContent.getExcludingDesktopWindows(
                excludingDesktopWindows, onScreenWindowsOnly: onScreenWindowsOnly
            ) { content, error in
                if let content {
                    continuation.resume(returning: Box(content))
                } else {
                    continuation.resume(throwing: error ?? Unavailable(reason: "no-content"))
                }
            }
        }
        return box.content
    }
}
