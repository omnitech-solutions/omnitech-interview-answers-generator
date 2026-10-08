import AVFoundation
import CoreGraphics
import StudioShellCore

// What macOS says about the permissions a session listens and watches with. Read
// only: it never prompts. Screen Recording gates the call's audio only while
// ScreenCaptureKit carries it (CallAudioReport says which capture does).
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
