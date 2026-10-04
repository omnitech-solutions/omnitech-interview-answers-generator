import AppKit
import StudioShellCore
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = ShellModel()
    private var panel: PanelController!
    private var statusMenu: StatusMenu!
    private let hotkeys = HotkeyCenter()
    private var webDelegate: StudioWebViewDelegate!
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.load()
        let handler = BridgeHandler(model: model) { [weak self] pinned in self?.panel.setPinned(pinned) }
        webDelegate = StudioWebViewDelegate(model: model)
        let webView = StudioWebView.make(handler: handler, delegate: webDelegate)
        model.webView = webView
        panel = PanelController(webView: webView)
        panel.setPinned(model.pinned)

        statusMenu = StatusMenu(
            model: model,
            actions: .init(
                openStudio: { [weak self] in self?.openStudio() },
                openInBrowser: { [weak self] in
                    if let url = self?.model.location?.studioURL { NSWorkspace.shared.open(url) }
                },
                switchSession: { [weak self] choice in self?.switchSession(choice) },
                togglePause: { [weak self] in
                    guard let self else { return }
                    Task { @MainActor in
                        await self.model.togglePause()
                    }
                },
                togglePin: { [weak self] in
                    guard let self else { return }
                    self.model.pinned.toggle()
                    self.panel.setPinned(self.model.pinned)
                    self.statusMenu.rebuild()
                },
                captureAnalyze: { [weak self] in self?.captureAnalyze() },
                toggleVisibility: { [weak self] in self?.panel.toggle() },
                connect: { [weak self] in self?.connect() },
                disconnect: { [weak self] in
                    guard let self else { return }
                    self.model.disconnect()
                    self.panel.hide()
                },
                quit: { NSApp.terminate(nil) }))
        model.onChange = { [weak self] in
            guard let self else { return }
            self.statusMenu.rebuild()
            self.panel.setSubtitle(self.model.connection.title)
        }
        hotkeys.register(HotkeyBinding.all) { [weak self] action in
            switch action {
            case .captureAnalyze: self?.captureAnalyze()
            case .toggleVisibility: self?.panel.toggle()
            }
        }
        statusMenu.setUnavailable(hotkeys.unavailable)
        installMainMenu()

        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.model.refresh() }
        if model.location == nil { connect() } else { openStudio() }
    }

    // First launch, and "Change Connection…".
    private func connect() {
        guard let location = ConnectPrompt.run(pairing: model.pairing, current: model.location) else { return }
        model.paired(location)
        openStudio()
    }

    private func openStudio() {
        guard let location = model.location else { return connect() }
        if model.webView?.url == nil { model.webView?.load(URLRequest(url: location.overlayURL())) }
        panel.show()
        model.refresh()
    }

    private func switchSession(_ choice: SessionChoice) {
        guard let location = model.location else { return }
        model.webView?.load(URLRequest(url: location.overlayURL(sessionId: choice.id)))
        panel.show()
    }

    // The same press as the card's Alt+Shift+A: the page decides what to do with
    // it and takes the capture through the host adapter.
    private func captureAnalyze() {
        guard model.location != nil else { return }
        openStudio()
        model.webView?.evaluateJavaScript(HostBridgeScript.emit(.captureAnalyze), completionHandler: nil)
    }

    // An accessory app has no menu bar of its own; the Edit menu exists so
    // copy and paste reach the web view when the panel is key.
    private func installMainMenu() {
        let main = NSMenu()
        let edit = NSMenuItem()
        let menu = NSMenu(title: "Edit")
        menu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        menu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = menu
        main.addItem(edit)
        NSApp.mainMenu = main
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
