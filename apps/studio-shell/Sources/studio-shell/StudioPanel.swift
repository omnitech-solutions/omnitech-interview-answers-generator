import AppKit
import StudioShellCore
import WebKit

// The floating window class (panels and the compact window). It does not take the
// app forward by merely appearing, so showing it leaves the interview window
// frontmost; PRESSING it makes Interview Studio the active app (menu bar, Cmd-Tab),
// and capture still reads the last other application (FocusSampling).
// `sharingType` is left at its default on purpose: it shows in screen shares
// (ADR-0019).
final class StudioPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // A press activates the app (and only this window's app, not every window).
    override func sendEvent(_ event: NSEvent) {
        let pressed = event.type == .leftMouseDown || event.type == .rightMouseDown
        if PanelActivation.shouldActivate(pressed: pressed, appIsActive: NSApp.isActive) {
            NSRunningApplication.current.activate(options: [])
        }
        super.sendEvent(event)
    }

    // A non-activating panel gets no menu bar, so the standard editing keys are
    // sent to the web view here.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
            let key = event.charactersIgnoringModifiers
        else { return super.performKeyEquivalent(with: event) }
        let action: Selector? = switch key {
        case "c": #selector(NSText.copy(_:))
        case "v": #selector(NSText.paste(_:))
        case "x": #selector(NSText.cut(_:))
        case "a": #selector(NSText.selectAll(_:))
        case "z": Selector(("undo:"))
        default: nil
        }
        if let action, NSApp.sendAction(action, to: nil, from: self) { return true }
        return super.performKeyEquivalent(with: event)
    }
}
