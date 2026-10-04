import AppKit
import StudioShellCore

// The menu-bar item: the shell's one control surface besides the window.
final class StatusMenu: NSObject, NSMenuDelegate {
    struct Actions {
        var openStudio: () -> Void
        var openInBrowser: () -> Void
        var switchSession: (SessionChoice) -> Void
        var togglePause: () -> Void
        var togglePin: () -> Void
        var captureAnalyze: () -> Void
        var toggleVisibility: () -> Void
        var connect: () -> Void
        var disconnect: () -> Void
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
        let state = NSMenuItem(title: "Interview Studio · \(model.connection.title)", action: nil, keyEquivalent: "")
        state.isEnabled = false
        menu.addItem(state)
        let truth = NSMenuItem(title: VisibilityTruth.line, action: nil, keyEquivalent: "")
        truth.isEnabled = false
        menu.addItem(truth)
        menu.addItem(.separator())

        let paired = model.location != nil
        add("Open Studio", #selector(openStudio), enabled: paired)
        add("Open Studio in Browser", #selector(openInBrowser), enabled: paired)

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

        let pin = add("Pin on Top", #selector(togglePin), enabled: true)
        pin.state = model.pinned ? .on : .off
        let keys = Dictionary(uniqueKeysWithValues: HotkeyBinding.all.map { ($0.action, $0) })
        add(keyed("Capture & Analyze", keys[.captureAnalyze]), #selector(captureAnalyze), enabled: paired)
        add(keyed("Show or Hide Window", keys[.toggleVisibility]), #selector(toggleVisibility), enabled: paired)
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
    @objc private func openInBrowser() { actions.openInBrowser() }
    @objc private func switchSession(_ sender: NSMenuItem) {
        if choices.indices.contains(sender.tag) { actions.switchSession(choices[sender.tag]) }
    }
    @objc private func togglePause() { actions.togglePause() }
    @objc private func togglePin() { actions.togglePin() }
    @objc private func captureAnalyze() { actions.captureAnalyze() }
    @objc private func toggleVisibility() { actions.toggleVisibility() }
    @objc private func connect() { actions.connect() }
    @objc private func disconnect() { actions.disconnect() }
    @objc private func quit() { actions.quit() }
}
