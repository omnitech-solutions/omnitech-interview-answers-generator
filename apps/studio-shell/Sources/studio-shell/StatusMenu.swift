import AppKit
import StudioShellCore

// The menu-bar item: a control surface besides the windows. It issues the same
// typed presentation commands a page can (PresentationController.perform).
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
    struct Actions {
        var openStudio: () -> Void
        var signIn: () -> Void
        var signOut: () -> Void
        var openInBrowser: () -> Void
        var switchSession: (SessionChoice) -> Void
        var togglePause: () -> Void
        var togglePin: () -> Void
        // Every presentation item calls the one command entry the pages use.
        var present: (PresentationCommand) -> Void
        var presentation: () -> PresentationState
        var send: (HostCommand) -> Void
        var connect: () -> Void
        var disconnect: () -> Void
        var engineHint: () -> String?
        var stopListening: () -> Void
        var quit: () -> Void
    }

    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let model: ShellModel
    private let actions: Actions
    private var unavailableKeys: [HotkeyBinding] = []
    private var choices: [SessionChoice] = []

    init(model: ShellModel, actions: Actions) {
        self.model = model
        self.actions = actions
        super.init()
        item.button?.image = NSImage(systemSymbolName: "rectangle.on.rectangle", accessibilityDescription: "Interview Studio")
        item.button?.toolTip = "Interview Studio · \(VisibilityTruth.line)"
        menu.delegate = self
        item.menu = menu
        rebuild()
    }

    func setUnavailable(_ keys: [HotkeyBinding]) { unavailableKeys = keys; rebuild() }

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild()
        Task { @MainActor in
            await model.refreshSessions()
            rebuild()
        }
    }

    func rebuild() {
        menu.removeAllItems()
        // The dot says the window takes clicks: green (always, now that See-through works by region).
        let interactive = actions.presentation().interaction.isInteractive
        item.button?.attributedTitle = NSAttributedString(
            string: " ●", attributes: [.foregroundColor: interactive ? NSColor.systemGreen : NSColor.systemRed])
        let state = NSMenuItem(title: "Interview Studio · \(model.connection.title)", action: nil, keyEquivalent: "")
        state.isEnabled = false
        menu.addItem(state)
        let truth = NSMenuItem(title: VisibilityTruth.line, action: nil, keyEquivalent: "")
        truth.isEnabled = false
        menu.addItem(truth)
        menu.addItem(.separator())

        let paired = model.location != nil
        if StatusMenuRules.showsSignIn(model.connection) { add("Sign in to Studio…", #selector(signIn), enabled: true) }
        add(actions.presentation().appMode == .expanded ? "Minify to Compact Window" : "Expand to Studio", #selector(toggleMode), enabled: paired)
        add("Open Studio", #selector(openStudio), enabled: paired)
        add("Open Studio in Browser", #selector(openInBrowser), enabled: paired)
        // Ends this Mac's Studio session only; offered while Studio says someone is signed in.
        add("Sign out", #selector(signOut), enabled: StatusMenuRules.signOutEnabled(paired: paired, signedIn: model.signedIn))

        let switcher = NSMenuItem(title: "Switch Session", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        choices = model.sessions
        if choices.isEmpty {
            let none = NSMenuItem(title: "No open sessions", action: nil, keyEquivalent: "")
            none.isEnabled = false
            sub.addItem(none)
        }
        for (index, choice) in choices.enumerated() {
            let entry = NSMenuItem(title: choice.menuTitle(), action: #selector(switchSession(_:)), keyEquivalent: "")
            entry.target = self
            entry.tag = index
            entry.state = choice.id == model.current?.id ? .on : .off
            sub.addItem(entry)
        }
        switcher.submenu = sub
        switcher.isEnabled = paired
        menu.addItem(switcher)

        let paused = model.current?.isPaused == true
        add(paused ? "Resume Session" : "Pause Session", #selector(togglePause), enabled: model.current?.isOpen == true)
        menu.addItem(.separator())

        let pstate = actions.presentation()
        let pin = add("Pin on Top", #selector(togglePin), enabled: true)
        pin.state = model.pinned ? .on : .off
        let keys = Dictionary(HotkeyBinding.all.map { ($0.action, $0) }, uniquingKeysWith: { first, _ in first })
        add(keyed("Capture & Analyze", keys[.captureAnalyze]), #selector(captureAnalyze), enabled: paired)
        add(keyed("Start/Stop Listening", keys[.toggleMic]), #selector(toggleMic), enabled: paired)
        if let hint = actions.engineHint() {
            let note = NSMenuItem(title: hint, action: nil, keyEquivalent: "")
            note.isEnabled = false
            menu.addItem(note)
        }
        add("Stop Listening", #selector(stopListening), enabled: paired)
        add(keyed("Clear Session", keys[.clearSession]), #selector(clearSession), enabled: paired)
        menu.addItem(.separator())

        // Window
        add(keyed(pstate.hidden ? "Show Window" : "Hide Window", keys[.toggleVisibility]), #selector(toggleVisibility), enabled: paired)
        add(keyed("See-through", keys[.toggleInteraction]), #selector(toggleInteraction), enabled: paired)
        add("Settings", #selector(openSettings), enabled: paired)
        let shortcuts = add("Global Shortcuts", #selector(toggleHotkeys), enabled: true)
        shortcuts.state = pstate.hotkeysEnabled ? .on : .off
        for key in unavailableKeys {
            let note = NSMenuItem(title: "\(key.label) is used by another app", action: nil, keyEquivalent: "")
            note.isEnabled = false
            menu.addItem(note)
        }
        menu.addItem(.separator())
        add(paired ? "Change Connection…" : "Connect…", #selector(connect), enabled: true)
        if paired { add("Disconnect", #selector(disconnect), enabled: true) }
        add("Quit Interview Studio", #selector(quit), enabled: true)
    }

    private func keyed(_ title: String, _ binding: HotkeyBinding?) -> String {
        binding.map { "\(title)    \($0.label)" } ?? title
    }

    @discardableResult
    private func add(_ title: String, _ action: Selector, enabled: Bool) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        entry.isEnabled = enabled
        menu.addItem(entry)
        return entry
    }

    @objc private func openStudio() { actions.openStudio() }
    @objc private func signIn() { actions.signIn() }
    @objc private func signOut() { actions.signOut() }
    @objc private func openInBrowser() { actions.openInBrowser() }
    @objc private func switchSession(_ sender: NSMenuItem) {
        if choices.indices.contains(sender.tag) { actions.switchSession(choices[sender.tag]) }
    }
    @objc private func togglePause() { actions.togglePause() }
    @objc private func togglePin() { actions.togglePin() }
    @objc private func captureAnalyze() { actions.send(.captureAnalyze) }
    @objc private func stopListening() { actions.stopListening() }
    @objc private func toggleMic() { actions.send(.transcribeToggle) }
    @objc private func clearSession() { actions.send(.sessionClear) }
    @objc private func toggleMode() { actions.present(.toggleAppMode) }
    @objc private func toggleVisibility() { actions.present(.toggleVisible) }
    @objc private func toggleInteraction() { actions.send(.seeThroughToggle) }
    @objc private func openSettings() { actions.present(.openSettings) }
    @objc private func toggleHotkeys() { actions.present(.setHotkeysEnabled(!actions.presentation().hotkeysEnabled)) }
    @objc private func connect() { actions.connect() }
    @objc private func disconnect() { actions.disconnect() }
    @objc private func quit() { actions.quit() }
}
