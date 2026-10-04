import Foundation

// [DOMAIN] System-wide shortcuts, registered with Carbon's RegisterEventHotKey,
// which needs no Accessibility or Input Monitoring permission (it receives only
// its own registered combination, never other keystrokes). Option+Shift+letter
// matches the card's own Alt+Shift+A, so the key does the same thing in and out
// of the window. The modifier values are Carbon's (optionKey, shiftKey).
public struct HotkeyBinding: Equatable, Sendable {
    public enum Action: String, Sendable { case captureAnalyze, toggleVisibility }

    public let action: Action
    public let keyCode: UInt32
    public let carbonModifiers: UInt32
    public let label: String

    public static let optionShift: UInt32 = 0x0800 | 0x0200

    public static let all: [HotkeyBinding] = [
        HotkeyBinding(action: .captureAnalyze, keyCode: 0x00, carbonModifiers: optionShift, label: "⌥⇧A"),
        HotkeyBinding(action: .toggleVisibility, keyCode: 0x09, carbonModifiers: optionShift, label: "⌥⇧V"),
    ]
}
