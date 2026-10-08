import CaptureCore

// [DOMAIN] What the page is told about the call's audio: which capture the
// person chose, which one carries it now (the tap, or ScreenCaptureKit by
// choice or by fallback), and the state of the permission THAT capture needs.
// Screen Recording gates the call's audio only while ScreenCaptureKit carries
// it. Through the tap the permission is System Audio Recording, which macOS
// gives no way to read: it is "granted" once real sound arrived and
// "undetermined" until then, never guessed and never borrowed from the screen.
public struct CallAudioReport: Equatable, Sendable {
    public let selected: CallAudioSource
    public let active: CallAudioSource
    public let state: PermissionState
    public let tapSupported: Bool

    public init(
        selected: CallAudioSource, active: CallAudioSource, evidence: TapEvidence, screen: PermissionState,
        tapSupported: Bool
    ) {
        self.selected = selected
        self.active = active
        self.tapSupported = tapSupported
        switch active {
        case .screenCaptureKit: state = screen
        case .processTap: state = evidence == .heardSound ? .granted : .undetermined
        }
    }

    // Closed names and one flag only.
    public var wire: [String: Any] {
        [
            "selected": selected.rawValue, "active": active.rawValue, "permission": state.rawValue,
            "tapSupported": tapSupported,
        ]
    }
}
