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

    // The page this window moves by: any empty part of it drags the window.
    weak var dragSurface: WKWebView?
    private var pressed: NSEvent?
    private var dragAsked = false

    // A press activates the app (and only this window's app, not every window).
    override func sendEvent(_ event: NSEvent) {
        let pressed = event.type == .leftMouseDown || event.type == .rightMouseDown
        if PanelActivation.shouldActivate(pressed: pressed, appIsActive: NSApp.isActive) {
            NSRunningApplication.current.activate(options: [])
        }
        trackDrag(event)
        super.sendEvent(event)
    }

    // [DOMAIN] A web view takes every mouse event, so the window is dragged from here:
    // once a press travels past the threshold the page says whether that spot is
    // empty (WindowDrag); the press is still held, so the drag starts from it.
    private func trackDrag(_ event: NSEvent) {
        switch event.type {
        case .leftMouseDown:
            pressed = event
            dragAsked = false
        case .leftMouseUp:
            pressed = nil
        case .leftMouseDragged:
            guard let start = pressed, !dragAsked, let web = dragSurface,
                WindowDrag.exceedsThreshold(
                    dx: Double(event.locationInWindow.x - start.locationInWindow.x),
                    dy: Double(event.locationInWindow.y - start.locationInWindow.y))
            else { return }
            dragAsked = true
            var point = web.convert(start.locationInWindow, from: nil)
            if !web.isFlipped { point.y = web.bounds.height - point.y }
            web.evaluateJavaScript(WindowDrag.probeScript(x: Double(point.x), y: Double(point.y))) {
                [weak self] result, _ in
                guard let self, result as? Bool == true, let down = self.pressed,
                    NSEvent.pressedMouseButtons & 1 == 1
                else { return }
                self.pressed = nil
                self.performDrag(with: down)
            }
        default: break
        }
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
