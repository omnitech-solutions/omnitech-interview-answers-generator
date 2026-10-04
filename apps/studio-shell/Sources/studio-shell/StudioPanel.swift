import AppKit
import StudioShellCore
import WebKit

// The floating window. Titled, so it can be dragged and resized and its title
// states the truth: it is visible and shows in screen shares. Non-activating, so
// pressing it leaves the interview window frontmost (the one "focused window"
// capture reads). `sharingType` is left at its default on purpose.
final class StudioPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

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

final class PanelController {
    let panel: StudioPanel
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        panel = StudioPanel(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 680),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel, .utilityWindow],
            backing: .buffered, defer: false)
        panel.title = "Interview Studio · \(VisibilityTruth.line)"
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.minSize = NSSize(width: 320, height: 360)
        panel.contentView = webView
        let name = "StudioShellPanel"
        if !panel.setFrameUsingName(name) {
            let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            panel.setFrameOrigin(NSPoint(x: area.maxX - 460, y: area.minY + 24))
        }
        panel.setFrameAutosaveName(name)
    }

    var isVisible: Bool { panel.isVisible }

    func setPinned(_ pinned: Bool) {
        panel.level = pinned ? .floating : .normal
    }

    // Shows without activating the app, so the focused window stays focused.
    func show() { panel.orderFrontRegardless() }
    func hide() { panel.orderOut(nil) }
    func toggle() { isVisible ? hide() : show() }

    func setSubtitle(_ text: String) { panel.subtitle = text }
}
