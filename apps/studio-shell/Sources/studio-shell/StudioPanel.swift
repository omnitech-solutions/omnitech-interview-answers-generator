import AppKit
import StudioShellCore
import WebKit

// The floating window class (panels and the compact window). It does not take the
// app forward by merely appearing, so showing it leaves the interview window
// frontmost; PRESSING it makes Interview Studio the active app (menu bar, Cmd-Tab),
// and capture still reads the last other application (FocusSampling).
// `sharingType` is left at its default on purpose: it shows in screen shares
// (ADR-0019).
// [DOMAIN] macOS lets only the frontmost app set the cursor. The panel is for use
// beside another app's window (the interview), so it asks the window server to
// honour its cursor while in the background: the same connection property other
// overlay and utility apps set. A private symbol: if it ever goes missing the
// panel still works and shows the arrow until the app is active.
@_silgen_name("CGSMainConnectionID")
private func CGSMainConnectionID() -> Int32
@_silgen_name("CGSSetConnectionProperty")
private func CGSSetConnectionProperty(_ cid: Int32, _ target: Int32, _ key: CFString, _ value: CFTypeRef) -> Int32

enum BackgroundCursor {
    @MainActor private static var enabled = false
    @MainActor static func enable() {
        guard !enabled else { return }
        enabled = true
        let connection = CGSMainConnectionID()
        _ = CGSSetConnectionProperty(connection, connection, "SetsCursorInBackground" as CFString, kCFBooleanTrue)
    }
}

final class StudioPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // The page this window moves by: any empty part of it drags the window.
    weak var dragSurface: WKWebView?
    private var pressed: NSEvent?
    private var dragAsked = false

    // [DOMAIN] The cursor over the page, set here because the web view does not apply
    // CSS cursors while the app is inactive (the panel never takes the app forward by
    // appearing). Moves are asked of the page one at a time, the newest point winning.
    private var cursorBusy = false
    private var cursorNext: NSPoint?
    private var shownKind: WindowDrag.Kind = .arrow

    override func mouseMoved(with event: NSEvent) {
        cursorNext = event.locationInWindow
        probeCursor()
    }

    override func mouseExited(with event: NSEvent) {
        cursorNext = nil
        shownKind = .arrow
    }

    private func probeCursor() {
        guard !cursorBusy, let at = cursorNext, let web = dragSurface else { return }
        cursorNext = nil
        cursorBusy = true
        var point = web.convert(at, from: nil)
        if !web.isFlipped { point.y = web.bounds.height - point.y }
        web.evaluateJavaScript(WindowDrag.probeScript(x: Double(point.x), y: Double(point.y))) {
            [weak self] result, _ in
            guard let self else { return }
            self.cursorBusy = false
            let kind = (result as? String).flatMap(WindowDrag.Kind.init(rawValue:)) ?? .arrow
            // A held button is a drag or a press in progress: leave the cursor as it is.
            if NSEvent.pressedMouseButtons == 0 { self.show(kind) }
            self.probeCursor()
        }
    }

    private func show(_ kind: WindowDrag.Kind) {
        shownKind = kind
        switch kind {
        case .pointer: NSCursor.pointingHand.set()
        case .text: NSCursor.iBeam.set()
        case .grab: NSCursor.openHand.set()
        case .arrow: NSCursor.arrow.set()
        }
    }

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
                guard let self, (result as? String) == WindowDrag.Kind.grab.rawValue, let down = self.pressed,
                    NSEvent.pressedMouseButtons & 1 == 1
                else { return }
                self.pressed = nil
                // The closed hand for as long as the window is held; performDrag returns on release.
                NSCursor.closedHand.set()
                self.performDrag(with: down)
                self.show(.grab)
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
        let action: Selector? =
            switch key {
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
