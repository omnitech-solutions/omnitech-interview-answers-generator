import CoreGraphics
import Foundation
import JavaScriptCore
import StudioShellCore

private final class MemoryStore: SettingsStore {
    var values: [String: String] = [:]
    func string(forKey key: String) -> String? { values[key] }
    func set(_ value: String?, forKey key: String) { values[key] = value }
}

@MainActor
private final class RecordingSurface: PresentationSurface {
    var rendered: [PresentationState] = []
    var toasts: [Toast] = []
    var quits = 0
    var fronts = 0
    var sizes: [[Double?]] = []
    func setCompactSize(width: Double, height: Double?) { sizes.append([width, height]) }
    func render(_ state: PresentationState) { rendered.append(state) }
    func bringToFront() { fronts += 1 }
    func toast(_ toast: Toast) { toasts.append(toast) }
    func quit() { quits += 1 }
}

private let display = CGRect(x: 0, y: 25, width: 1440, height: 875)

@MainActor
func presentationTests(_ t: Harness) async {
    await t.test("in the one window, the page asks for a width and a fitted height; nothing else changes") {
        let controller = PresentationController(prefs: ShellPrefs(store: MemoryStore()))
        let surface = RecordingSurface()
        controller.surface = surface
        controller.perform(.setWindowSize(width: 1260, height: nil))
        controller.perform(.setWindowSize(width: 540, height: 120))
        t.expectEqual(surface.sizes.count, 2)
        t.expectEqual(surface.sizes[0][0], 1260)
        t.expectEqual(surface.sizes[1][1], 120)
        t.expect(controller.state.compactShown && controller.state.appMode == .minified, "still the one window")
    }
    await t.test("click-through in the one window: the window stays shown, ignores the mouse, and the toggle brings it back") {
        let controller = PresentationController(prefs: ShellPrefs(store: MemoryStore()))
        let surface = RecordingSurface()
        controller.surface = surface
        t.expect(controller.state.compactShown && !controller.state.interaction.ignoresMouseEvents, "interactive by default")
        controller.perform(.toggleInteractionMode)
        t.expect(surface.rendered.last?.compactShown == true, "still on screen while click-through")
        t.expect(surface.rendered.last?.interaction.ignoresMouseEvents == true, "the one window follows interaction state")
        // The hotkey that turns it back on stays registered and routed while the window ignores the mouse.
        let registered = HotkeyBinding.all.filter { !$0.requiresInteractive }
        t.expect(registered.contains { $0.action == .toggleInteraction && $0.label == "⌘⇧I" }, "⌘⇧I always registered")
        t.expectEqual(HotkeyRouting.effect(for: .toggleInteraction, interactive: false), .present(.toggleInteractionMode))
        controller.perform(.setInteractionMode(true))
        t.expect(surface.rendered.last?.interaction.ignoresMouseEvents == false)
        // OFF persists as OFF; the next launch starts from the saved choice.
        let store = MemoryStore()
        PresentationController(prefs: ShellPrefs(store: store)).perform(.setInteractionMode(false))
        t.expect(!PresentationController(prefs: ShellPrefs(store: store)).state.interaction.isInteractive)
    }

    await t.test("Settings opens beside the one window; the chat key is an intent that never touches the windows") {
        let controller = PresentationController(prefs: ShellPrefs(store: MemoryStore()))
        let surface = RecordingSurface()
        controller.surface = surface
        controller.perform(.openSettings)
        t.expect(controller.state.compactShown, "the one window stays")
        t.expect(controller.state.settingsShown)
        t.expectEqual(HostReply.tookEffect(.openSettings, controller.state), true)
        controller.perform(.closeSettings)
        t.expect(!controller.state.settingsShown)
        t.expectEqual(HostReply.tookEffect(.closeSettings, controller.state), true)
        // The chat key sends an intent to the page; the page owns the input.
        t.expectEqual(HotkeyRouting.effect(for: .showChat, interactive: false), .intent(.chatFocus))
        t.expectEqual(HostCommand.chatFocus.wireName, "chat.focus")
        t.expectEqual(HostBridgeScript.emit(.chatFocus), "window.__studioHostEmit && window.__studioHostEmit(\"chat.focus\");")
        t.expectEqual(HotkeyRouting.effect(for: .openSettings, interactive: false), .present(.openSettings))
        // Settings hides with the window and never survives into the expanded form.
        controller.perform(.openSettings)
        controller.perform(.setVisible(false))
        t.expect(!controller.state.settingsShown && !controller.state.compactShown)
        controller.perform(.setAppMode(.expanded))
        t.expect(!controller.state.settingsShown && controller.state.mainWindowShown)
    }

    // MARK: window frames
    await t.test("default frames sit bottom-right (compact) and top-right (Settings) and always fit the display") {
        let compact = PanelLayout.defaultFrame(.compact, in: display)
        t.expectEqual(compact.size, WindowKind.compact.defaultSize)
        t.expectEqual(compact.maxX, display.maxX - PanelLayout.margin)
        t.expectEqual(compact.minY, display.minY + PanelLayout.margin)
        let settings = PanelLayout.defaultFrame(.settings, in: display)
        t.expectEqual(settings.size, CGSize(width: 400, height: 380))
        t.expectEqual(settings.maxX, display.maxX - PanelLayout.margin)
        t.expectEqual(settings.maxY, display.maxY - PanelLayout.topInset)
        for kind in WindowKind.allCases {
            for area in [display, CGRect(x: 0, y: 0, width: 800, height: 500), CGRect(x: 0, y: 0, width: 1920, height: 1055)] {
                t.expect(area.contains(PanelLayout.defaultFrame(kind, in: area)), "\(kind) fits \(area.size)")
            }
        }
        t.expectEqual(WindowKind.compact.queryName, "single")
        t.expectEqual(WindowKind.settings.queryName, "settings")
    }

    await t.test("frames persist as text and are restored only when sane and reachable (never lost off-screen)") {
        let store = MemoryStore()
        let prefs = ShellPrefs(store: store)
        let frame = CGRect(x: 120, y: 200, width: 500, height: 400)
        prefs.saveFrame(.compact, frame)
        t.expectEqual(store.values["shell.compact.frame"], "120,200,500,400")
        t.expectEqual(prefs.savedFrame(.compact, displays: [display]), frame)
        // Off every display: default wins.
        prefs.saveFrame(.compact, CGRect(x: 9000, y: 9000, width: 500, height: 400))
        t.expectEqual(prefs.savedFrame(.compact, displays: [display]), nil)
        t.expectEqual(prefs.frame(.compact, displays: [display], main: display), PanelLayout.defaultFrame(.compact, in: display))
        // Only a sliver on screen is not enough; a grabbable strip is.
        prefs.saveFrame(.compact, CGRect(x: display.maxX - 20, y: 200, width: 500, height: 400))
        t.expectEqual(prefs.savedFrame(.compact, displays: [display]), nil)
        prefs.saveFrame(.compact, CGRect(x: display.maxX - 200, y: 200, width: 500, height: 400))
        t.expect(prefs.savedFrame(.compact, displays: [display]) != nil)
        // Smaller than the window's minimum, junk, and non-finite are refused.
        prefs.saveFrame(.settings, CGRect(x: 0, y: 100, width: 10, height: 10))
        t.expectEqual(prefs.savedFrame(.settings, displays: [display]), nil)
        t.expectEqual(PanelFrameCodec.decode("1,2,3"), nil)
        t.expectEqual(PanelFrameCodec.decode("a,b,c,d"), nil)
        t.expectEqual(PanelFrameCodec.decode("1,2,nan,4"), nil)
        // Settings and the main window have their own frames.
        prefs.saveFrame(.settings, CGRect(x: 300, y: 300, width: 400, height: 380))
        t.expectEqual(store.values["panel.settings.frame2"], "300,300,400,380")
        prefs.saveMainWindowFrame(CGRect(x: 50, y: 60, width: 1000, height: 700))
        t.expectEqual(prefs.mainWindowFrame(displays: [display], main: display), CGRect(x: 50, y: 60, width: 1000, height: 700))
    }

    // MARK: interaction mode
    await t.test("interaction mode: default ON takes clicks; OFF is click-through; dot and toast say which") {
        var state = InteractionState()
        t.expect(state.isInteractive && !state.ignoresMouseEvents, "panels must be usable by default")
        t.expectEqual(state.dot, .green)
        t.expectEqual(state.toast, Toast("Interaction Mode: ON", "Green dot, Interact with window like scroll, copy, move"))
        state.toggle()
        t.expect(!state.isInteractive && state.ignoresMouseEvents)
        t.expectEqual(state.dot, .red)
        t.expectEqual(state.toast, Toast("Interaction Mode: OFF", "Red dot shows interaction mode is off"))
        t.expect(!state.set(false), "setting the same value changes nothing")
        t.expect(state.set(true))
        let prefs = ShellPrefs(store: MemoryStore())
        t.expect(prefs.interaction.isInteractive, "interactive by default")
        prefs.interaction = InteractionState(isInteractive: false)
        t.expect(!prefs.interaction.isInteractive, "persisted")
    }

    // MARK: window policy
    await t.test("the windows stay over any app, Space and full-screen window, and are never hidden from screen shares") {
        let pinned = PanelWindowTraits.of()
        t.expectEqual(pinned.level, .floating)
        t.expect(pinned.joinsAllSpaces && pinned.fullScreenAuxiliary && pinned.stationary, "collection behaviour")
        t.expect(!pinned.hidesOnDeactivate && pinned.nonActivating && pinned.borderless, "never hides, never activates")
        t.expectEqual(PanelWindowTraits.of(pinned: false).level, .normal)
        // No concealment: the type has no sharing/capture-exclusion trait at all.
        let names = Mirror(reflecting: pinned).children.compactMap(\.label)
        t.expect(!names.contains { $0.lowercased().contains("shar") || $0.lowercased().contains("protect") }, "no sharing trait")
        t.expect(VisibilityTruth.line.contains("shows in screen shares"))
    }

    // MARK: hotkeys -> intents
    await t.test("hotkeys map to typed intents and presentation commands; skill keys need interaction mode") {
        func effect(_ action: HotkeyBinding.Action, _ interactive: Bool = false) -> HotkeyEffect? {
            HotkeyRouting.effect(for: action, interactive: interactive)
        }
        t.expectEqual(effect(.captureAnalyze), .intent(.captureAnalyze))
        t.expectEqual(effect(.solutionGenerate), .intent(.solutionGenerate))
        t.expectEqual(effect(.toggleAuto), .intent(.autoToggle))
        t.expectEqual(effect(.toggleMic), .intent(.transcribeToggle))
        t.expectEqual(effect(.clearSession), .intent(.sessionClear))
        t.expectEqual(effect(.toggleVisibility), .present(.toggleVisible))
        t.expectEqual(effect(.toggleInteraction), .present(.toggleInteractionMode))
        t.expectEqual(effect(.toggleMode), .present(.toggleAppMode))
        t.expectEqual(effect(.skillNext), nil)
        t.expectEqual(effect(.skillNext, true), .intent(.skillNext))
        t.expectEqual(effect(.skillPrevious, true), .intent(.skillPrevious))
        t.expectEqual(effect(.showChat), .intent(.chatFocus))
        t.expectEqual(effect(.openSettings), .present(.openSettings))
        // Every binding has a mapping when interactive.
        for binding in HotkeyBinding.all { t.expect(effect(binding.action, true) != nil, "\(binding.label) maps") }
        // Wire names are the page-facing typed commands.
        t.expectEqual(HostCommand.captureAnalyze.wireName, "capture.analyze")
        t.expectEqual(HostCommand.autoToggle.wireName, "auto.toggle")
        t.expectEqual(HostCommand.solutionGenerate.wireName, "solution.generate")
        t.expectEqual(HostCommand.transcribeToggle.wireName, "transcribe.toggle")
        t.expectEqual(HostCommand.skillNext.wireName, "skill.next")
        t.expectEqual(HostCommand.skillPrevious.wireName, "skill.prev")
        t.expectEqual(HostCommand.sessionClear.wireName, "session.clear")
        // The panel move and resize keys are gone: the one window is moved by its toolbar and resized by its edges.
        t.expectEqual(HotkeyBinding.all.count, 18)
        t.expect(!HotkeyBinding.all.contains { $0.label.contains("⌃") }, "no control chords")
        t.expectEqual(HotkeyBinding.all.filter { $0.label.hasPrefix("⌘") || $0.label.hasPrefix("⌥") }.count, HotkeyBinding.all.count)
        // Only the skill keys are interaction-only; the others are always registered.
        t.expectEqual(HotkeyBinding.all.filter(\.requiresInteractive).map(\.action), [.skillPrevious, .skillNext])
    }

    await t.test("the video's hotkey table: Carbon codes and modifiers, secondary aliases after, skill keys gated") {
        let c = HotkeyBinding.command, sh = HotkeyBinding.shift, o = HotkeyBinding.option
        func binding(_ action: HotkeyBinding.Action) -> HotkeyBinding? { HotkeyBinding.all.first { $0.action == action } }
        let table: [(HotkeyBinding.Action, UInt32, UInt32, String)] = [
            (.captureAnalyze, 0x01, c | sh, "⌘⇧S"), (.toggleMic, 0x0F, o, "⌥R"), (.toggleInteraction, 0x22, c | sh, "⌘⇧I"),
            (.toggleVisibility, 0x09, c | sh, "⌘⇧V"), (.showChat, 0x08, c | sh, "⌘⇧C"), (.clearSession, 0x2A, c | sh, "⌘⇧\\"),
            (.skillPrevious, 0x7E, c, "⌘↑"), (.skillNext, 0x7D, c, "⌘↓"), (.openSettings, 0x2B, c, "⌘,"),
        ]
        for (action, code, mods, label) in table {
            let found = binding(action)
            t.expectEqual(found?.keyCode, code, "\(label) key")
            t.expectEqual(found?.carbonModifiers, mods, "\(label) modifiers")
            t.expectEqual(found?.label, label)
        }
        // Only the skill keys wait for interaction mode: without it they are not registered
        // and the routing refuses them.
        let always = HotkeyBinding.all.filter { !$0.requiresInteractive }
        t.expect(!always.contains { $0.action == .skillNext || $0.action == .skillPrevious })
        t.expectEqual(HotkeyRouting.effect(for: .skillPrevious, interactive: false), nil)
        t.expectEqual(HotkeyRouting.effect(for: .skillNext, interactive: true), .intent(.skillNext))
        // The old Option+Shift chords remain as aliases of the same actions.
        t.expect(HotkeyBinding.all.contains { $0.label == "⌥⇧A" && $0.action == .captureAnalyze })
        t.expect(HotkeyBinding.all.contains { $0.label == "⌥⇧R" && $0.action == .toggleMic })
        // No two bindings share a key combination.
        t.expectEqual(Set(HotkeyBinding.all.map { "\($0.keyCode)/\($0.carbonModifiers)" }).count, HotkeyBinding.all.count)
    }

    await t.test("toasts use the video's exact words and appear for the right keys") {
        t.expectEqual(ToastText.recording, Toast("Start/Stop Recording", "option + R"))
        t.expectEqual(HotkeyRouting.toast(for: .toggleMic), ToastText.recording)
        // The shell holds no skill: no key raises a skill toast, a capture least of all.
        for action in [HotkeyBinding.Action.skillNext, .skillPrevious, .captureAnalyze, .clearSession] {
            t.expectEqual(HotkeyRouting.toast(for: action), nil)
        }
        // Bottom-left of the display, click-through banner ~3 s.
        let frame = ToastLayout.frame(on: display)
        t.expectEqual(frame.minX, display.minX)
        t.expect(frame.minY < display.midY && display.contains(frame), "bottom-left, on screen")
        t.expectEqual(ToastLayout.seconds, 3)
        // The pages are told the shell shows them, so they do not duplicate.
        t.expectEqual(PresentationState.initial.wire["nativeToasts"] as? Bool, true)
    }

    await t.test("consent is asked once, persisted, and only then do pages get the flag") {
        let store = MemoryStore()
        t.expect(!Consent.isGranted(store))
        t.expect(Consent.pageScript(store) == nil, "no flag before consent")
        t.expect(Consent.prompt.hasPrefix("Everyone in this conversation agrees to it being recorded and to using AI assistance"))
        Consent.grant(store)
        t.expect(Consent.isGranted(store))
        t.expect(Consent.pageScript(store)?.contains("studio.shell.consented") == true)
        t.expect(Consent.isGranted(store), "persisted for the next launch")
    }

    await t.test("Settings Quit ends the app; first run is the one window and Settings never reopens by itself") {
        let store = MemoryStore()
        let controller = PresentationController(prefs: ShellPrefs(store: store))
        let surface = RecordingSurface()
        controller.surface = surface
        t.expectEqual(controller.state.appMode, .minified)
        t.expect(controller.state.compactShown && !controller.state.settingsShown, "one window by default")
        controller.perform(.openSettings)
        t.expect(controller.state.settingsShown)
        t.expect(!PresentationController(prefs: ShellPrefs(store: store)).state.settingsOpen, "settings never reopens by itself")
        t.expectEqual(HostCallDecoder.decode(["v": 1, "method": "presentation", "params": ["op": "quit"]]), .success(.presentation(.quitApp)))
        t.expectEqual(HostCallDecoder.decode(["v": 1, "method": "presentation", "params": ["op": "quit", "x": 1]]), .failure(.invalidParameters))
        controller.perform(.quitApp)
        t.expectEqual(surface.quits, 1)
        controller.perform(.bringToFront)
        t.expectEqual(surface.fronts, 1)
    }

    // MARK: presentation reducer
    await t.test("one command entry: minify/expand, hide, Settings, interaction mode, persisted") {
        let store = MemoryStore()
        let prefs = ShellPrefs(store: store)
        let controller = PresentationController(prefs: prefs)
        let surface = RecordingSurface()
        controller.surface = surface
        var pushed = 0
        controller.onChange = { _ in pushed += 1 }
        t.expectEqual(controller.state.appMode, .minified, "first run is minified")
        t.expect(!controller.state.mainWindowShown && controller.state.compactShown)

        controller.perform(.toggleAppMode)
        t.expectEqual(controller.state.appMode, .expanded)
        t.expect(controller.state.mainWindowShown && !controller.state.compactShown)
        controller.perform(.toggleAppMode)
        t.expect(controller.state.compactShown, "the compact window is reachable again")
        t.expectEqual(store.values["appMode2"], "minified", "last mode remembered")

        controller.perform(.setVisible(false))
        t.expect(!controller.state.compactShown && controller.state.hidden)
        controller.perform(.toggleVisible)
        t.expect(controller.state.compactShown)

        // Interaction mode toggles with a toast, persists, and is pushed to pages.
        surface.toasts = []
        controller.perform(.toggleInteractionMode)
        t.expect(!controller.state.interaction.isInteractive, "default ON, so the first toggle turns it OFF")
        t.expectEqual(surface.toasts.count, 1)
        t.expectEqual(store.values["interactive2"], "0")
        controller.perform(.setInteractionMode(false))
        t.expectEqual(surface.toasts.count, 1, "no toast when nothing changed")

        // Settings is for clicking: opening it turns interaction ON.
        controller.perform(.setInteractionMode(false))
        controller.perform(.openSettings)
        t.expect(controller.state.interaction.isInteractive && controller.state.settingsShown)

        // Opening Settings from the expanded form leaves it; hands-free is announced in the minified form.
        controller.perform(.setAppMode(.expanded))
        t.expect(!controller.state.settingsShown)
        t.expectEqual(controller.state.wire["handsFree"] as? Bool, false)
        controller.perform(.openSettings)
        t.expectEqual(controller.state.appMode, .minified)
        t.expectEqual(controller.state.wire["handsFree"] as? Bool, true)
        t.expect(pushed > 5)

        // The pages never read layout, panels or opacity: they no longer exist.
        for key in ["layout", "panels", "opacity"] { t.expect(controller.state.wire[key] == nil, "no \(key) on the wire") }

        // A restart restores the last mode and interaction choice.
        controller.perform(.setAppMode(.minified))
        let again = PresentationController(prefs: ShellPrefs(store: store))
        t.expectEqual(again.state.appMode, .minified)
        t.expect(again.state.interaction.isInteractive == controller.state.interaction.isInteractive)
    }

    // MARK: bridge: presentation
    await t.test("window.studioHost.presentation decodes typed commands and refuses everything else") {
        func decode(_ params: [String: Any]) -> Result<HostCall, HostCallError> {
            HostCallDecoder.decode(["v": 1, "method": "presentation", "params": params])
        }
        t.expectEqual(decode(["op": "openSettings"]), .success(.presentation(.openSettings)))
        t.expectEqual(decode(["op": "closeSettings"]), .success(.presentation(.closeSettings)))
        t.expectEqual(decode(["op": "setVisible", "visible": false]), .success(.presentation(.setVisible(false))))
        t.expectEqual(decode(["op": "setInteractionMode", "on": true]), .success(.presentation(.setInteractionMode(true))))
        t.expectEqual(decode(["op": "setAppMode", "mode": "minified"]), .success(.presentation(.setAppMode(.minified))))
        t.expectEqual(decode(["op": "setWindowSize", "width": 1260.0]), .success(.presentation(.setWindowSize(width: 1260, height: nil))))
        t.expectEqual(decode(["op": "setWindowSize", "width": 540.0, "height": 120.0]), .success(.presentation(.setWindowSize(width: 540, height: 120))))
        t.expectEqual(decode(["op": "setWindowSize", "width": 10.0]), .failure(.invalidParameters), "too narrow is refused")
        t.expectEqual(decode(["op": "setWindowSize", "width": 540.0, "height": 5.0]), .failure(.invalidParameters), "too short is refused")
        t.expectEqual(decode(["op": "setWindowSize", "width": 540.0, "x": 1]), .failure(.invalidParameters), "extra keys are refused")
        t.expectEqual(decode(["op": "setHotkeysEnabled", "enabled": false]), .success(.presentation(.setHotkeysEnabled(false))))
        t.expectEqual(decode(["op": "openSettings", "extra": 1]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setInteractionMode", "on": "yes"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setInteractionMode"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "launchRockets"]), .failure(.invalidParameters))
        t.expectEqual(decode([:]), .failure(.invalidParameters))
        // The removed multi-panel, layout and opacity operations are refused, with or without their old parameters.
        t.expectEqual(decode(["op": "open", "panel": "chat"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "close", "panel": "settings"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "focus", "panel": "analysis"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setLayout", "layout": "reading"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setOpacity", "value": 0.5]), .failure(.invalidParameters))
    }

    await t.test("the page-side presentation object matches the contract and mirrors pushed state") {
        let context = JSContext()!
        context.exceptionHandler = { _, value in print("js exception: \(value?.toString() ?? "?")") }
        context.evaluateScript("""
        var window = this; var __posted = [];
        window.webkit = { messageHandlers: { studioHost: { postMessage: function (m) { __posted.push(JSON.stringify(m)); return Promise.resolve(true); } } } };
        """)
        context.evaluateScript(HostBridgeScript.source(capabilities: HostCapability.allCases))
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.capabilities.join(',')")?.toString(),
            "always-on-top,click-through,all-spaces")
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.nativeToasts")?.toBool(), true, "pages must not duplicate toasts")
        for method in ["quit", "openSettings", "closeSettings", "setVisible", "interactionMode", "setInteractionMode", "onInteractionMode", "appMode", "setAppMode", "setHotkeysEnabled", "setWindowSize"] {
            t.expectEqual(context.evaluateScript("typeof window.studioHost.presentation.\(method)")?.toString(), "function", method)
        }
        for method in ["open", "close", "focus", "openPanels", "setLayout", "opacity", "setOpacity"] {
            t.expectEqual(context.evaluateScript("typeof window.studioHost.presentation.\(method)")?.toString(), "undefined", "\(method) is gone")
        }
        context.evaluateScript("""
        var heard = [];
        window.studioHost.presentation.onInteractionMode(function (on) { heard.push(on); });
        window.studioHost.presentation.closeSettings();
        window.studioHost.presentation.setInteractionMode(true);
        """)
        t.expectEqual(context.evaluateScript("__posted[0]")?.toString(), #"{"v":1,"method":"presentation","params":{"op":"closeSettings"}}"#)
        t.expect(context.evaluateScript("__posted[1]")?.toString().contains("\"op\":\"setInteractionMode\"") == true)
        var state = PresentationState.initial
        state.appMode = .minified
        state.interaction.set(false)
        context.evaluateScript(HostBridgeScript.emitPresentation(state))
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.interactionMode()")?.toBool(), false)
        t.expectEqual(context.evaluateScript("heard.join(',')")?.toString(), "false", "the change is heard once")
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.appMode()")?.toString(), "minified")
    }

    await t.test("a page is told it is a hands-free host through its address, and the window is selected by name") {
        let location = StudioLocation(address: "", tenantSlug: "local")!
        t.expectEqual(location.overlayURL(window: .compact, handsFree: true).absoluteString,
            "http://127.0.0.1:3100/t/local/p/interview/live/overlay?host=native&panel=single&handsfree=1")
        t.expectEqual(location.overlayURL(window: .settings, handsFree: true).absoluteString,
            "http://127.0.0.1:3100/t/local/p/interview/live/overlay?host=native&panel=settings&handsfree=1")
        t.expectEqual(location.overlayURL().absoluteString,
            "http://127.0.0.1:3100/t/local/p/interview/live/overlay?host=native")
    }
}
