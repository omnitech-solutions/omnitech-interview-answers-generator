import AppKit
import StudioShellCore
import StudioShellEngine
import WebKit

// App glue only. Every presentation behaviour is a typed `PresentationCommand`
// performed by the Core's `PresentationController`; the menu, the hotkeys and
// the pages' `window.studioHost.presentation` calls all reach it through
// `present(_:)`. The NativeSurface renders the state.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = ShellModel()
    private lazy var controller = PresentationController(prefs: model.prefs)
    private var surface: NativeSurface!
    private var statusMenu: StatusMenu!
    private let hotkeys = HotkeyCenter()
    private var webDelegate: StudioWebViewDelegate!
    private var handler: BridgeHandler!
    private var engine: HandsFreeEngine!
    private var timer: Timer?
    private var cookieWatcher: CookieWatcher?
    private var signIn: SignInCoordinator!
    // The session the pages are bound to (nil: Studio's current one).
    private var sessionId: String?
    // Intents for a page that has not finished loading yet.
    private var pending: [ObjectIdentifier: [HostCommand]] = [:]
    private var wasSignedOut = false

    // [DOMAIN] The panels poll Studio for results while another app is in front.
    // Without this, App Nap slows their timers and a result shows up only once
    // the person switches back. The system may still sleep when idle.
    private var napBlocker: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        napBlocker = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep], reason: "Keeping interview panels current")
        // First run: one native consent, before any page exists. Without it nothing
        // starts (the pages see no `studio.shell.consented` flag).
        guard requireConsent() else { exit(0) }
        model.load()
        engine = SystemEngine.make(webView: { [weak self] in self?.model.webView }, location: { [weak self] in self?.model.location })
        engine.onChange = { [weak self] snapshot in
            guard let self, let script = EngineBridge.emitScript(snapshot) else { return }
            for view in self.model.allViews { view.evaluateJavaScript(script, completionHandler: nil) }
            self.statusMenu?.rebuild()
        }
        handler = BridgeHandler(
            model: model, capture: ShellCapture(), engine: engine,
            setPinned: { [weak self] pinned in self?.surface.setPinned(pinned) },
            perform: { [weak self] command in self?.present(command) ?? PresentationState.initial })
        handler.onWatchChange = { [weak self] at, bits in
            guard let self else { return }
            for view in self.model.allViews { view.evaluateJavaScript(HostBridgeScript.emitScreenWatchChange(at: at, bits: bits), completionHandler: nil) }
        }
        handler.onWatchStatus = { [weak self] status in
            guard let self else { return }
            for view in self.model.allViews { view.evaluateJavaScript(HostBridgeScript.emitScreenWatchStatus(status), completionHandler: nil) }
        }
        webDelegate = StudioWebViewDelegate(model: model)
        webDelegate.onPageFinished = { [weak self] view in self?.pageFinished(view) }
        surface = NativeSurface(
            model: model,
            makeWebView: { [unowned self] in StudioWebView.make(handler: self.handler, delegate: self.webDelegate) },
            urlFor: { [weak self] target in self?.url(for: target) })
        surface.setPinned(model.pinned)
        surface.requestMode = { [weak self] mode in self?.present(.setAppMode(mode)) }
        surface.onRender = { [weak self] state in self?.rendered(state) }
        controller.surface = surface
        controller.onChange = { [weak self] state in self?.push(state) }
        signIn = SignInCoordinator(model: model) { [weak self] in self?.surface.anchorWindow }
        model.onSignInRequested = { [weak self] in self?.signIn.start() }
        model.onSignInAbandoned = { [weak self] in self?.signIn.cancel() }

        statusMenu = StatusMenu(
            model: model,
            actions: .init(
                openStudio: { [weak self] in self?.openStudio() },
                signIn: { [weak self] in self?.signIn.start() },
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
                    self.surface.setPinned(self.model.pinned)
                    self.statusMenu.rebuild()
                },
                present: { [weak self] command in self?.present(command) },
                presentation: { [weak self] in self?.controller.state ?? PresentationState.initial },
                send: { [weak self] command in self?.send(command) },
                setSkill: { [weak self] skill in
                    self?.model.skill = skill
                    self?.send(.setSkill(skill))
                },
                connect: { [weak self] in self?.connect() },
                disconnect: { [weak self] in
                    guard let self else { return }
                    // Revoking the pairing needs the signed-in web view, so the
                    // engine shuts down before the disconnect erases it.
                    Task { @MainActor in
                        self.handler.stopWatching()
                        await self.engine.shutdown(revoke: true)
                        self.model.disconnect()
                        self.present(.setPanelsVisible(false))
                    }
                },
                engineHint: { [weak self] in self?.engine.snapshot.hint },
                stopListening: { [weak self] in
                    guard let self else { return }
                    Task { @MainActor in await self.engine.stopLocally() }
                },
                quit: { NSApp.terminate(nil) }))
        model.onChange = { [weak self] in
            guard let self else { return }
            self.statusMenu.rebuild()
            // A sign-in finished in one page: the others pick up the new session.
            let signedOut = self.model.connection == .signInRequired
            if self.wasSignedOut, !signedOut, self.model.connection.isConnected { self.reloadIdleViews() }
            // A web-view sign-out ends any run: the engine cannot act without it.
            if signedOut, !self.wasSignedOut { self.handler.stopWatching(); Task { @MainActor in await self.engine.stop() } }
            self.wasSignedOut = signedOut
        }
        installMainMenu()

        // A cookie change (sign-in, sign-out, expiry) re-reads Studio's answer now,
        // so a sign-out invalidates in-flight requests without waiting for the timer.
        cookieWatcher = CookieWatcher { [weak self] in self?.model.refresh() }
        WKWebsiteDataStore.default().httpCookieStore.add(cookieWatcher!)

        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.model.refresh() }
        if model.location == nil { connect() } else { present(.setAppMode(controller.state.appMode)) }
    }

    // MARK: the one command entry

    @discardableResult
    private func present(_ command: PresentationCommand) -> PresentationState {
        // Showing anything before Studio is configured starts the connect flow.
        if model.location == nil, command != .setPanelsVisible(false) {
            connect()
            if model.location == nil { return controller.state }
        }
        return controller.perform(command)
    }

    // After every render: the hotkey set, the menu and the pages follow the state.
    private func rendered(_ state: PresentationState) {
        let wanted = state.hotkeysEnabled
            ? HotkeyBinding.all.filter { !$0.requiresInteractive || state.interaction.isInteractive } : []
        hotkeys.set(wanted) { [weak self] action in self?.fire(action) }
        statusMenu?.setUnavailable(hotkeys.unavailable)
        statusMenu?.rebuild()
    }

    private func fire(_ action: HotkeyBinding.Action) {
        guard let effect = HotkeyRouting.effect(for: action, interactive: controller.state.interaction.isInteractive) else { return }
        switch effect {
        case .intent(let command): send(command)
        case .present(let command): present(command)
        }
        // The skill is the shell's to name in the toast; the page gets the intent.
        if action == .skillNext { model.skill = model.skill.cycled(by: 1) }
        if action == .skillPrevious { model.skill = model.skill.cycled(by: -1) }
        if let toast = HotkeyRouting.toast(for: action, skill: model.skill) { surface.toast(toast) }
    }

    // [SAFETY] The first-run agreement. Persisted once; Quit leaves nothing running.
    private func requireConsent() -> Bool {
        let store = UserDefaultsStore()
        if Consent.isGranted(store) { return true }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = Consent.prompt
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Quit")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        Consent.grant(store)
        return true
    }

    // MARK: pages

    private func url(for target: SurfaceTarget) -> URL? {
        guard let location = model.location else { return nil }
        switch target {
        case .main: return location.studioURL
        case .compact: return location.overlayURL(sessionId: sessionId, single: true, handsFree: true)
        case .panel(let kind): return location.overlayURL(sessionId: sessionId, panel: kind, handsFree: true)
        }
    }

    private func push(_ state: PresentationState) {
        for view in model.allViews { view.evaluateJavaScript(HostBridgeScript.emitPresentation(state), completionHandler: nil) }
    }

    private func pageFinished(_ view: WKWebView) {
        view.evaluateJavaScript(HostBridgeScript.emitPresentation(controller.state), completionHandler: nil)
        view.evaluateJavaScript(HostBridgeScript.emitScreenWatchStatus(handler.watchStatus), completionHandler: nil)
        for command in pending.removeValue(forKey: ObjectIdentifier(view)) ?? [] {
            view.evaluateJavaScript(HostBridgeScript.emit(command), completionHandler: nil)
        }
    }

    // An intent goes to the pages as a typed event; the page decides what it
    // means. An action intent reaches the one panel that acts on it, opening
    // that panel first when the layout has not shown it yet.
    private func send(_ command: HostCommand) {
        guard model.location != nil else { return }
        let state = controller.state
        var views: [WKWebView] = []
        if state.mainWindowShown {
            views = [surface.mainWindowView].compactMap { $0 }
        } else if state.layout == .compact {
            if !state.compactShown { present(.setAppMode(.minified)) }
            views = [surface.compactView].compactMap { $0 }
        } else if let target = command.target {
            if !state.shownPanels.contains(target) { present(.openPanel(target)) }
            views = [surface.view(for: target)].compactMap { $0 }
        } else {
            views = surface.panelViews
        }
        for view in views {
            if view.isLoading || view.url == nil {
                pending[ObjectIdentifier(view), default: []].append(command)
            } else {
                view.evaluateJavaScript(HostBridgeScript.emit(command), completionHandler: nil)
            }
        }
    }

    private func reloadIdleViews() { surface.reloadAll() }

    // First launch, and "Change Connection…".
    private func connect() {
        guard let location = ConnectPrompt.run(pairing: model.pairing, current: model.location) else { return }
        let changed = model.location != location
        model.paired(location)
        // A rebind loads the new Studio; the old pages and their requests are gone.
        if changed { handler.stopWatching(); surface.reloadAll() }
        present(.setAppMode(controller.state.appMode))
        model.refresh()
    }

    private func openStudio() {
        present(.setAppMode(.expanded))
        model.refresh()
    }

    private func switchSession(_ choice: SessionChoice) {
        sessionId = choice.id
        surface.reloadAll()
        present(.setAppMode(controller.state.appMode))
    }

    // A regular app: the standard app menu (Cmd-Q), Edit, View and Window.
    private func installMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Interview Studio", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Interview Studio", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Interview Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let edit = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu
        main.addItem(edit)

        let view = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        let toggle = NSMenuItem(title: "Minify / Expand", action: #selector(menuToggleMode), keyEquivalent: "m")
        toggle.keyEquivalentModifierMask = [.command, .shift]
        toggle.target = self
        viewMenu.addItem(toggle)
        view.submenu = viewMenu
        main.addItem(view)

        let window = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.submenu = windowMenu
        main.addItem(window)
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    @objc private func menuToggleMode() { present(.toggleAppMode) }

    // Clicking the Dock icon with nothing showing expands the app.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, controller.state.appMode == .expanded { present(.setAppMode(.expanded)) }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        handler.stopWatching()
        // Quit stops sources quietly; the pairing stays (only Disconnect revokes).
        Task { @MainActor in
            await self.engine.shutdown(revoke: false)
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

final class CookieWatcher: NSObject, WKHTTPCookieStoreObserver {
    private let onChange: () -> Void
    init(onChange: @escaping () -> Void) { self.onChange = onChange }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) { DispatchQueue.main.async(execute: onChange) }
}
