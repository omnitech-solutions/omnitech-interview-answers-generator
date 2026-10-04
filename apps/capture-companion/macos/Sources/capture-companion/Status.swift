import CaptureAdapters
import CaptureCore

// [SAFETY] Everything the executable prints is built here from static strings,
// states and counts. There is no function that accepts transcript text, a
// window title, an address or a credential, and a source scan test fails if a
// print call anywhere else does not go through `Status`.
enum Status {
    static let usage = "usage: capture-companion pair | run [--microphone] [--app-audio] [--screen] [--locale <id>] [--window-title <text>] | stop | status | windows"
    static let promptAddress = "Studio address (https://...): "
    static let promptSlug = "Workspace slug: "
    static let promptCredential = "Session credential (input hidden): "
    static let paired = "paired: credential stored in the Keychain"
    static let invalidAddress = "refused: the Studio address or workspace slug is not valid"
    static let invalidCredential = "refused: that is not a session credential"
    static let keychainFailed = "refused: the Keychain could not store the credential"
    static let notPaired = "not-paired: run `capture-companion pair` first"
    static let noSources = "refused: choose at least one of --microphone, --app-audio, --screen"
    static let alreadyRunning = "refused: a companion is already running"
    static let stopSent = "stop signal sent"
    static let notRunning = "not-running"
    static let running = "running"
    static let markerPresent = "stopped-locally marker: present"
    static let markerAbsent = "stopped-locally marker: absent"
    static let stopHint = "listening controls: type s then Enter, press Ctrl-C, or run `capture-companion stop` to stop locally"
    static let speechUnavailable = "speech-unavailable: on-device recognition is not ready, so no audio source was started"

    static func screenAccess(granted: Bool) -> String {
        granted
            ? "screen-recording: granted"
            : "screen-recording: not granted (System Settings > Privacy & Security > Screen Recording)"
    }
    static let windowsUnavailable = "windows: unavailable (ScreenCaptureKit could not list windows)"
    static let captureIgnored = "capture-request-ignored: the screen source is not running"
    static let captureExpired = "capture-request-expired: its deadline passed before it could be captured"
    static let captureSourceChanged = "capture-request-refused: the screen selection changed since the region was drawn"
    static func captureLoss(_ loss: CaptureLoss) -> String { "capture-lost: \(loss.rawValue)" }
    static func captureDone(_ mode: CaptureMode) -> String { "capture-sent: \(mode.rawValue)" }
    // One diagnostic row: the owning application's NAME, its layer, flags and
    // the title LENGTH. No function here accepts a window title.
    static func windowLine(_ window: WindowSummary) -> String {
        "window: app=\(window.applicationName) layer=\(window.layer) on-screen=\(window.isOnScreen) "
            + "frontmost=\(window.isFrontmostApplication) title-length=\(window.titleLength)"
    }

    static let blank = ""
    static let pairedAlready = "paired"
    static func state(_ state: CompanionState) -> String { "state: \(state.rawValue)" }
    static func speechReason(_ failure: SpeechFailure) -> String { "reason: \(failure.rawValue)" }
    static func selected(_ sources: [CaptureSource]) -> String {
        "sources: " + sources.map(\.rawValue).joined(separator: ", ")
    }
    static func queued(_ count: Int) -> String { "queued: \(count)" }
    static func pid(_ value: Int32) -> String { "pid: \(value)" }
}
