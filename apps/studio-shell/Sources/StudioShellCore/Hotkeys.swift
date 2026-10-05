import Foundation

// [DOMAIN] System-wide shortcuts, registered with Carbon's RegisterEventHotKey,
// which needs no Accessibility or Input Monitoring permission (it receives only
// its own registered combination, never other keystrokes). Option+Shift+letter
// matches the card's own Alt+Shift+A, so the key does the same thing in and out
// of the window. The modifier values are Carbon's. Skill cycling (Cmd+Up/Down)
// is registered only while interaction mode is ON, so Cmd+Arrow keeps working
// in other apps the rest of the time. Every other key stays registered while the
// window ignores the mouse: Cmd+Shift+I is the way back from click-through.
public struct HotkeyBinding: Equatable, Sendable {
    public enum Action: String, Sendable {
        case captureAnalyze, solutionGenerate, toggleAuto, toggleVisibility, toggleInteraction, toggleMic, clearSession
        case toggleMode, bringToFront, skillNext, skillPrevious, showChat, openSettings
        case moveLeft, moveRight, moveUp, moveDown
        case resizeNarrower, resizeWider, resizeTaller, resizeShorter
    }

    public let action: Action
    public let keyCode: UInt32
    public let carbonModifiers: UInt32
    public let label: String
    // True: registered only while interaction mode is ON.
    public let requiresInteractive: Bool

    public init(action: Action, keyCode: UInt32, carbonModifiers: UInt32, label: String, requiresInteractive: Bool = false) {
        self.action = action
        self.keyCode = keyCode
        self.carbonModifiers = carbonModifiers
        self.label = label
        self.requiresInteractive = requiresInteractive
    }

    public static let command: UInt32 = 0x0100
    public static let shift: UInt32 = 0x0200
    public static let option: UInt32 = 0x0800
    public static let control: UInt32 = 0x1000
    public static let optionShift: UInt32 = option | shift
    public static let controlOption: UInt32 = control | option

    // The video's keys come first (a lookup by action finds them); the old
    // Option+Shift chords stay as secondary aliases of the same actions.
    public static let all: [HotkeyBinding] = [
        HotkeyBinding(action: .captureAnalyze, keyCode: 0x01, carbonModifiers: command | shift, label: "⌘⇧S"),
        HotkeyBinding(action: .toggleMic, keyCode: 0x0F, carbonModifiers: option, label: "⌥R"),
        HotkeyBinding(action: .toggleInteraction, keyCode: 0x22, carbonModifiers: command | shift, label: "⌘⇧I"),
        HotkeyBinding(action: .toggleVisibility, keyCode: 0x09, carbonModifiers: command | shift, label: "⌘⇧V"),
        HotkeyBinding(action: .showChat, keyCode: 0x08, carbonModifiers: command | shift, label: "⌘⇧C"),
        HotkeyBinding(action: .clearSession, keyCode: 0x2A, carbonModifiers: command | shift, label: "⌘⇧\\"),
        HotkeyBinding(action: .skillPrevious, keyCode: 0x7E, carbonModifiers: command, label: "⌘↑", requiresInteractive: true),
        HotkeyBinding(action: .skillNext, keyCode: 0x7D, carbonModifiers: command, label: "⌘↓", requiresInteractive: true),
        HotkeyBinding(action: .openSettings, keyCode: 0x2B, carbonModifiers: command, label: "⌘,"),
        // Secondary aliases.
        HotkeyBinding(action: .captureAnalyze, keyCode: 0x00, carbonModifiers: optionShift, label: "⌥⇧A"),
        HotkeyBinding(action: .solutionGenerate, keyCode: 0x05, carbonModifiers: optionShift, label: "⌥⇧G"),
        HotkeyBinding(action: .toggleAuto, keyCode: 0x20, carbonModifiers: optionShift, label: "⌥⇧U"),
        HotkeyBinding(action: .toggleVisibility, keyCode: 0x09, carbonModifiers: optionShift, label: "⌥⇧V"),
        HotkeyBinding(action: .toggleInteraction, keyCode: 0x22, carbonModifiers: optionShift, label: "⌥⇧I"),
        HotkeyBinding(action: .toggleMic, keyCode: 0x0F, carbonModifiers: optionShift, label: "⌥⇧R"),
        HotkeyBinding(action: .clearSession, keyCode: 0x2A, carbonModifiers: optionShift, label: "⌥⇧\\"),
        HotkeyBinding(action: .toggleMode, keyCode: 0x2E, carbonModifiers: optionShift, label: "⌥⇧M"),
        HotkeyBinding(action: .bringToFront, keyCode: 0x11, carbonModifiers: optionShift, label: "⌥⇧T"),
        HotkeyBinding(action: .moveLeft, keyCode: 0x7B, carbonModifiers: controlOption, label: "⌃⌥←"),
        HotkeyBinding(action: .moveRight, keyCode: 0x7C, carbonModifiers: controlOption, label: "⌃⌥→"),
        HotkeyBinding(action: .moveUp, keyCode: 0x7E, carbonModifiers: controlOption, label: "⌃⌥↑"),
        HotkeyBinding(action: .moveDown, keyCode: 0x7D, carbonModifiers: controlOption, label: "⌃⌥↓"),
        HotkeyBinding(action: .resizeNarrower, keyCode: 0x7B, carbonModifiers: controlOption | shift, label: "⌃⌥⇧←"),
        HotkeyBinding(action: .resizeWider, keyCode: 0x7C, carbonModifiers: controlOption | shift, label: "⌃⌥⇧→"),
        HotkeyBinding(action: .resizeTaller, keyCode: 0x7E, carbonModifiers: controlOption | shift, label: "⌃⌥⇧↑"),
        HotkeyBinding(action: .resizeShorter, keyCode: 0x7D, carbonModifiers: controlOption | shift, label: "⌃⌥⇧↓"),
    ]
}

// [DOMAIN] What a key does. A key never runs a workflow of its own: it is an
// INTENT sent to the pages (exactly as the card's own key is), a presentation
// command (the same typed command a page can issue through the bridge). The
// shell keeps no skill state: next/previous are intents the pages act on.
public enum HotkeyEffect: Equatable, Sendable {
    case intent(HostCommand)
    case present(PresentationCommand)
}

public enum HotkeyRouting {
    public static let nudge = 40.0

    // The toast a key shows, if any.
    public static func toast(for action: HotkeyBinding.Action) -> Toast? {
        action == .toggleMic ? ToastText.recording : nil
    }

    // `moveUp` is dy > 0: AppKit coordinates have the origin bottom-left. Keys
    // resize the analysis panel, the one with room to grow.
    public static func effect(for action: HotkeyBinding.Action, interactive: Bool) -> HotkeyEffect? {
        switch action {
        case .captureAnalyze: return .intent(.captureAnalyze)
        case .solutionGenerate: return .intent(.solutionGenerate)
        case .toggleAuto: return .intent(.autoToggle)
        case .toggleMic: return .intent(.transcribeToggle)
        case .clearSession: return .intent(.sessionClear)
        case .toggleVisibility: return .present(.togglePanelsVisible)
        case .toggleInteraction: return .present(.toggleInteractionMode)
        case .toggleMode: return .present(.toggleAppMode)
        case .bringToFront: return .present(.bringToFront)
        case .showChat: return .intent(.chatFocus)
        case .openSettings: return .present(.openPanel(.settings))
        // [GUARD] Skill keys act only while interaction mode is ON.
        case .skillNext: return interactive ? .intent(.skillNext) : nil
        case .skillPrevious: return interactive ? .intent(.skillPrevious) : nil
        case .moveLeft: return .present(.movePanels(dx: -nudge, dy: 0))
        case .moveRight: return .present(.movePanels(dx: nudge, dy: 0))
        case .moveUp: return .present(.movePanels(dx: 0, dy: nudge))
        case .moveDown: return .present(.movePanels(dx: 0, dy: -nudge))
        case .resizeNarrower: return .present(.resizePanel(.analysis, dw: -nudge, dh: 0))
        case .resizeWider: return .present(.resizePanel(.analysis, dw: nudge, dh: 0))
        case .resizeTaller: return .present(.resizePanel(.analysis, dw: 0, dh: nudge))
        case .resizeShorter: return .present(.resizePanel(.analysis, dw: 0, dh: -nudge))
        }
    }
}
