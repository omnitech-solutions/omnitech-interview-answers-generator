import AVFoundation
import CoreGraphics
import StudioShellCore

// What macOS says about the permissions a session listens and watches with. Read
// only: it never prompts. Screen Recording also gates the app's audio, so the page
// shows one state for both.
enum ShellPermissions {
    static func microphone() -> PermissionState {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: .granted
        case .notDetermined: .undetermined
        default: .denied
        }
    }

    // The system cannot say "not asked yet" for the screen: no grant reads as denied.
    static func screen() -> PermissionState {
        CGPreflightScreenCaptureAccess() ? .granted : .denied
    }
}
