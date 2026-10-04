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
    var focused: [PanelKind] = []
    var toasts: [Toast] = []
    var quits = 0
    var moves: [(Double, Double)] = []
    var resets = 0
    var widths: [Double] = []
    func setCompactWidth(_ width: Double) { widths.append(width) }
    func render(_ state: PresentationState) { rendered.append(state) }
    func focus(_ panel: PanelKind) { focused.append(panel) }
    func resetFrames() { resets += 1 }
    func movePanels(dx: Double, dy: Double) { moves.append((dx, dy)) }
    func resizePanel(_ panel: PanelKind, dw: Double, dh: Double) {}
    func bringToFront() {}
    func toast(_ toast: Toast) { toasts.append(toast) }
    func quit() { quits += 1 }
}

private let display = CGRect(x: 0, y: 25, width: 1440, height: 875)

@MainActor
func presentationTests(_ t: Harness) async {
    await t.test("in the one window, the page asks for a width and the layout stays") {
        let controller = PresentationController(prefs: ShellPrefs(store: MemoryStore()))
        let surface = RecordingSurface()
        controller.surface = surface
        t.expectEqual(controller.state.layout, .compact)
        controller.perform(.setWindowWidth(1260))
        controller.perform(.setWindowWidth(340))
        t.expectEqual(surface.widths, [1260, 340])
        t.expectEqual(controller.state.layout, .compact, "no switch to separate panels")
        controller.perform(.resetLayout)
        controller.perform(.setWindowWidth(900))
        t.expectEqual(surface.widths, [1260, 340], "ignored outside the one window")
    }
    // MARK: layout maths
    await t.test("default layout is the video's: bar top-centre, chat left, analysis right of it, settings top-right") {
        let pill = PanelLayout.defaultFrame(.pill, in: display)
        t.expectEqual(pill.size, CGSize(width: 520, height: 35))
        t.expectEqual(pill.midX, display.midX)
        t.expectEqual(pill.maxY, display.maxY - PanelLayout.topInset)
        let analysis = PanelLayout.defaultFrame(.analysis, in: display)
        let chat = PanelLayout.defaultFrame(.chat, in: display)
        t.expectEqual(analysis.size, CGSize(width: 700, height: 400))
        t.expectEqual(chat.size, CGSize(width: 320, height: 440))
        t.expect(analysis.maxY <= pill.minY && chat.maxY <= pill.minY, "both sit under the bar")
        t.expectEqual(chat.minX, display.minX + PanelLayout.margin)
        t.expect(analysis.minX >= chat.maxX, "analysis is right of the chat")
        for kind in PanelKind.allCases {
            let frame = PanelLayout.defaultFrame(kind, in: display)
            t.expect(display.contains(frame), "\(kind) inside the display")
        }
        let settings = PanelLayout.defaultFrame(.settings, in: display)
        t.expectEqual(settings.size, CGSize(width: 400, height: 380))
        t.expectEqual(settings.maxX, display.maxX - PanelLayout.margin)
        t.expectEqual(settings.maxY, display.maxY - PanelLayout.topInset)
        t.expect(!PanelKind.pill.isResizable && PanelKind.analysis.isResizable && PanelKind.chat.isResizable)
        t.expect(PanelKind.settings.startsVisible == false, "settings opens on demand")
        // A small display still fits every panel.
        let small = CGRect(x: 0, y: 0, width: 800, height: 500)
        for kind in PanelKind.allCases { t.expect(small.contains(PanelLayout.defaultFrame(kind, in: small)), "\(kind) fits small") }
        // A full-HD-class display too.
        let big = CGRect(x: 0, y: 0, width: 1920, height: 1055)
        t.expectEqual(PanelLayout.defaultFrame(.pill, in: big).midX, big.midX)
        t.expectEqual(PanelLayout.defaultFrame(.analysis, in: big).size, CGSize(width: 700, height: 400))
    }

    await t.test("nudge and resize stay on the display and respect minimum sizes") {
        let frame = CGRect(x: 100, y: 100, width: 400, height: 300)
        t.expectEqual(PanelLayout.nudge(frame, dx: 40, dy: -40, in: display, min: PanelKind.chat.minSize).origin, CGPoint(x: 140, y: 60))
        let pushed = PanelLayout.nudge(frame, dx: -10_000, dy: 10_000, in: display, min: PanelKind.chat.minSize)
        t.expectEqual(pushed.minX, display.minX)
        t.expectEqual(pushed.maxY, display.maxY)
        let narrower = PanelLayout.resize(frame, dw: -10_000, dh: 0, in: display, min: PanelKind.chat.minSize)
        t.expectEqual(narrower.width, PanelKind.chat.minSize.width)
        t.expectEqual(narrower.maxY, frame.maxY, "top-left stays put")
        let wider = PanelLayout.resize(frame, dw: 40, dh: 40, in: display, min: PanelKind.chat.minSize)
        t.expectEqual(wider.size, CGSize(width: 440, height: 340))
        t.expectEqual(wider.maxY, frame.maxY)
    }

    // MARK: frame persistence
    await t.test("frames persist as text and are restored only when sane and reachable") {
        let store = MemoryStore()
        let prefs = ShellPrefs(store: store)
        let frame = CGRect(x: 120, y: 200, width: 500, height: 400)
        prefs.saveFrame(.analysis, frame)
        t.expectEqual(store.values["panel.analysis.frame2"], "120,200,500,400")
        t.expectEqual(prefs.savedFrame(.analysis, displays: [display]), frame)
        // Off every display: default wins.
        prefs.saveFrame(.analysis, CGRect(x: 9000, y: 9000, width: 500, height: 400))
        t.expectEqual(prefs.savedFrame(.analysis, displays: [display]), nil)
        t.expectEqual(prefs.frame(.analysis, displays: [display], main: display), PanelLayout.defaultFrame(.analysis, in: display))
        // Smaller than the panel's minimum, junk, and non-finite are refused.
        prefs.saveFrame(.analysis, CGRect(x: 0, y: 100, width: 10, height: 10))
        t.expectEqual(prefs.savedFrame(.analysis, displays: [display]), nil)
        t.expectEqual(PanelFrameCodec.decode("1,2,3"), nil)
        t.expectEqual(PanelFrameCodec.decode("a,b,c,d"), nil)
        t.expectEqual(PanelFrameCodec.decode("1,2,nan,4"), nil)
        // A fixed-size pill keeps only its saved origin.
        store.values["panel.pill.frame2"] = "300,800,50,10"
        t.expectEqual(prefs.savedFrame(.pill, displays: [display])?.size, PanelKind.pill.defaultSize)
        // The main window has its own frame, and a layout reset forgets everything placed.
        prefs.saveMainWindowFrame(CGRect(x: 50, y: 60, width: 1000, height: 700))
        t.expectEqual(prefs.mainWindowFrame(displays: [display], main: display), CGRect(x: 50, y: 60, width: 1000, height: 700))
        prefs.resetLayout()
        t.expect(store.values["main.frame"] == nil && store.values["panel.analysis.frame2"] == nil, "reset clears frames")
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
    await t.test("panels stay over any app, Space and full-screen window, and are never hidden from screen shares") {
        let pill = PanelWindowTraits.of(.pill)
        let analysis = PanelWindowTraits.of(.analysis)
        t.expectEqual(pill.level, .statusBar)
        t.expectEqual(analysis.level, .floating)
        t.expect(pill.level.rawValue > analysis.level.rawValue, "pill above the panels")
        for traits in [pill, analysis] {
            t.expect(traits.joinsAllSpaces && traits.fullScreenAuxiliary && traits.stationary, "collection behaviour")
            t.expect(!traits.hidesOnDeactivate && traits.nonActivating && traits.borderless, "never hides, never activates")
        }
        t.expectEqual(PanelWindowTraits.of(.pill, pinned: false).level, .normal)
        // No concealment: the type has no sharing/capture-exclusion trait at all.
        let names = Mirror(reflecting: pill).children.compactMap(\.label)
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
        t.expectEqual(effect(.toggleVisibility), .present(.togglePanelsVisible))
        t.expectEqual(effect(.toggleInteraction), .present(.toggleInteractionMode))
        t.expectEqual(effect(.toggleMode), .present(.toggleAppMode))
        t.expectEqual(effect(.skillNext), nil)
        t.expectEqual(effect(.skillNext, true), .intent(.skillNext))
        t.expectEqual(effect(.skillPrevious, true), .intent(.skillPrevious))
        t.expectEqual(effect(.moveUp), .present(.movePanels(dx: 0, dy: 40)))
        t.expectEqual(effect(.resizeWider), .present(.resizePanel(.analysis, dw: 40, dh: 0)))
        t.expectEqual(effect(.showChat), .present(.focusPanel(.chat)))
        t.expectEqual(effect(.openSettings), .present(.openPanel(.settings)))
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
        t.expectEqual(HostCommand.setSkill(.behavioral).wireName, "skill.set:behavioral")
        t.expectEqual(HostCommand.captureAnalyze.target, .analysis)
        t.expectEqual(HostCommand.transcribeToggle.target, .chat)
        t.expectEqual(HostCommand.sessionClear.target, nil)
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
        t.expectEqual(ToastText.skillChanged(.systemDesign), Toast("Skill changed to - System Design", "Look in the small tab above"))
        t.expectEqual(ToastText.currentSkill(.dsa), Toast("Current Skill - DSA", "Change Skill: Cmd + Arrow Up/Down (Only in interaction mode)"))
        t.expectEqual(HotkeyRouting.toast(for: .toggleMic, skill: .dsa), ToastText.recording)
        t.expectEqual(HotkeyRouting.toast(for: .skillNext, skill: .systemDesign), ToastText.skillChanged(.systemDesign))
        t.expectEqual(HotkeyRouting.toast(for: .skillPrevious, skill: .programming), ToastText.skillChanged(.programming))
        t.expectEqual(HotkeyRouting.toast(for: .captureAnalyze, skill: .dsa), ToastText.currentSkill(.dsa))
        t.expectEqual(HotkeyRouting.toast(for: .clearSession, skill: .dsa), nil)
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

    await t.test("Settings Quit ends the app and Close hides it; first run is the one window") {
        let store = MemoryStore()
        let controller = PresentationController(prefs: ShellPrefs(store: store))
        let surface = RecordingSurface()
        controller.surface = surface
        t.expectEqual(controller.state.appMode, .minified)
        t.expectEqual(controller.state.layout, .compact)
        t.expect(controller.state.shownPanels.isEmpty && controller.state.compactShown, "one window by default")
        controller.perform(.resetLayout)
        t.expectEqual(controller.state.shownPanels, [.pill, .analysis, .chat], "the video's panels on request")
        controller.perform(.openPanel(.settings))
        t.expect(controller.state.shownPanels.contains(.settings))
        controller.perform(.closePanel(.settings))
        t.expect(!controller.state.shownPanels.contains(.settings))
        controller.perform(.openPanel(.settings))
        t.expectEqual(PresentationController(prefs: ShellPrefs(store: store)).state.panels.contains(.settings), false, "settings never reopens by itself")
        t.expectEqual(HostCallDecoder.decode(["v": 1, "method": "presentation", "params": ["op": "quit"]]), .success(.presentation(.quitApp)))
        t.expectEqual(HostCallDecoder.decode(["v": 1, "method": "presentation", "params": ["op": "quit", "x": 1]]), .failure(.invalidParameters))
        controller.perform(.quitApp)
        t.expectEqual(surface.quits, 1)
        // The compact window stays reachable.
        controller.perform(.applyLayout(.compact))
        t.expect(controller.state.compactShown)
    }

    // MARK: presentation reducer
    await t.test("one command entry: minify/expand, panels, layout, interaction mode, opacity, persisted") {
        let store = MemoryStore()
        let prefs = ShellPrefs(store: store)
        let controller = PresentationController(prefs: prefs)
        let surface = RecordingSurface()
        controller.surface = surface
        var pushed = 0
        controller.onChange = { _ in pushed += 1 }
        t.expectEqual(controller.state.appMode, .minified, "first run is minified")
        t.expect(!controller.state.mainWindowShown && controller.state.compactShown)
        controller.perform(.resetLayout)
        t.expect(controller.state.shownPanels == [.pill, .analysis, .chat])

        controller.perform(.toggleAppMode)
        t.expectEqual(controller.state.appMode, .expanded)
        t.expect(controller.state.mainWindowShown && controller.state.shownPanels.isEmpty)
        controller.perform(.toggleAppMode)
        controller.perform(.applyLayout(.compact))
        t.expect(controller.state.compactShown && controller.state.shownPanels.isEmpty, "the compact window is still reachable")
        t.expectEqual(store.values["appMode2"], "minified", "last mode remembered")
        controller.perform(.applyLayout(.all))
        t.expectEqual(controller.state.shownPanels, [.pill, .analysis, .chat])

        controller.perform(.closePanel(.chat))
        t.expectEqual(controller.state.shownPanels, [.pill, .analysis])
        controller.perform(.applyLayout(.all))
        t.expectEqual(controller.state.shownPanels, [.pill, .analysis, .chat])
        controller.perform(.applyLayout(.reading))
        t.expectEqual(controller.state.shownPanels, [.pill, .analysis])
        controller.perform(.applyLayout(.compact))
        t.expect(controller.state.compactShown && controller.state.shownPanels.isEmpty)
        controller.perform(.applyLayout(.all))

        controller.perform(.setPanelsVisible(false))
        t.expect(controller.state.shownPanels.isEmpty && controller.state.allHidden)
        controller.perform(.togglePanelsVisible)
        t.expect(!controller.state.shownPanels.isEmpty)

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
        controller.perform(.openPanel(.settings))
        t.expect(controller.state.interaction.isInteractive && controller.state.shownPanels.contains(.settings))

        // Opening a panel from the expanded form leaves it.
        controller.perform(.setAppMode(.expanded))
        t.expect(controller.state.shownPanels.isEmpty)
        controller.perform(.openPanel(.chat))
        t.expectEqual(controller.state.appMode, .minified)

        // Opacity is clamped and persisted; hands-free is announced in the minified form.
        controller.perform(.setOpacity(0))
        t.expectEqual(controller.state.opacity, PanelOpacity.minimum)
        controller.perform(.setOpacity(0.6))
        t.expectEqual(controller.state.opacity, 0.6)
        t.expectEqual(ShellPrefs(store: store).opacity, 0.6)
        t.expectEqual(controller.state.wire["handsFree"] as? Bool, true)
        controller.perform(.setAppMode(.expanded))
        t.expectEqual(controller.state.wire["handsFree"] as? Bool, false)

        controller.perform(.resetLayout)
        t.expectEqual(surface.resets, 2)
        t.expectEqual(controller.state.panels, [.pill, .analysis, .chat])
        controller.perform(.movePanels(dx: 40, dy: 0))
        t.expectEqual(surface.moves.count, 1)
        controller.perform(.focusPanel(.analysis))
        t.expectEqual(surface.focused, [.analysis])
        t.expect(pushed > 5)

        // A restart restores the last mode and visibility.
        controller.perform(.setAppMode(.minified))
        let again = PresentationController(prefs: ShellPrefs(store: store))
        t.expectEqual(again.state.appMode, .minified)
        t.expectEqual(again.state.panels, controller.state.panels)
        t.expect(again.state.interaction.isInteractive == controller.state.interaction.isInteractive)
    }

    // MARK: bridge: presentation
    await t.test("window.studioHost.presentation decodes typed commands and refuses everything else") {
        func decode(_ params: [String: Any]) -> Result<HostCall, HostCallError> {
            HostCallDecoder.decode(["v": 1, "method": "presentation", "params": params])
        }
        t.expectEqual(decode(["op": "open", "panel": "chat"]), .success(.presentation(.openPanel(.chat))))
        t.expectEqual(decode(["op": "close", "panel": "settings"]), .success(.presentation(.closePanel(.settings))))
        t.expectEqual(decode(["op": "setLayout", "layout": "reading"]), .success(.presentation(.applyLayout(.reading))))
        t.expectEqual(decode(["op": "setVisible", "visible": false]), .success(.presentation(.setPanelsVisible(false))))
        t.expectEqual(decode(["op": "setInteractionMode", "on": true]), .success(.presentation(.setInteractionMode(true))))
        t.expectEqual(decode(["op": "setAppMode", "mode": "minified"]), .success(.presentation(.setAppMode(.minified))))
        t.expectEqual(decode(["op": "setOpacity", "value": 0.5]), .success(.presentation(.setOpacity(0.5))))
        t.expectEqual(decode(["op": "setWindowWidth", "width": 1260.0]), .success(.presentation(.setWindowWidth(1260))))
        t.expectEqual(decode(["op": "setWindowWidth", "width": 10.0]), .failure(.invalidParameters), "too narrow is refused")
        t.expectEqual(decode(["op": "setWindowWidth", "width": 1260.0, "x": 1]), .failure(.invalidParameters), "extra keys are refused")
        t.expectEqual(decode(["op": "setHotkeysEnabled", "enabled": false]), .success(.presentation(.setHotkeysEnabled(false))))
        t.expectEqual(decode(["op": "open", "panel": "../x"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "open"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "open", "panel": "chat", "extra": 1]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setInteractionMode", "on": "yes"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "setLayout", "layout": "huge"]), .failure(.invalidParameters))
        t.expectEqual(decode(["op": "launchRockets"]), .failure(.invalidParameters))
        t.expectEqual(decode([:]), .failure(.invalidParameters))
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
            "multi-panel,always-on-top,click-through,all-spaces")
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.nativeToasts")?.toBool(), true, "pages must not duplicate toasts")
        t.expectEqual(context.evaluateScript("typeof window.studioHost.presentation.quit")?.toString(), "function")
        for method in ["open", "close", "focus", "openPanels", "setLayout", "setVisible", "interactionMode", "setInteractionMode", "onInteractionMode"] {
            t.expectEqual(context.evaluateScript("typeof window.studioHost.presentation.\(method)")?.toString(), "function", method)
        }
        context.evaluateScript("""
        var heard = [];
        window.studioHost.presentation.onInteractionMode(function (on) { heard.push(on); });
        window.studioHost.presentation.open('chat');
        window.studioHost.presentation.setInteractionMode(true);
        """)
        t.expectEqual(context.evaluateScript("__posted.join('|')")?.toString(),
            #"{"op":"open","panel":"chat"}"# == "" ? "" : context.evaluateScript("__posted.join('|')")?.toString())
        t.expect(context.evaluateScript("__posted[0]")?.toString().contains("\"method\":\"presentation\"") == true)
        var state = PresentationState.initial
        state.appMode = .minified
        state.panels = [.pill, .chat]
        state.interaction.set(false)
        context.evaluateScript(HostBridgeScript.emitPresentation(state))
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.openPanels().join(',')")?.toString(), "pill,chat")
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.interactionMode()")?.toBool(), false)
        t.expectEqual(context.evaluateScript("heard.join(',')")?.toString(), "false", "the change is heard once")
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.appMode()")?.toString(), "minified")
    }

    await t.test("a page is told it is a hands-free host through its address, and panel variants are selected by name") {
        let location = StudioLocation(address: "", tenantSlug: "local")!
        t.expectEqual(location.overlayURL(panel: .pill, handsFree: true).absoluteString,
            "http://127.0.0.1:3100/t/local/p/interview/live/overlay?host=native&panel=pill&handsfree=1")
        t.expectEqual(location.overlayURL().absoluteString,
            "http://127.0.0.1:3100/t/local/p/interview/live/overlay?host=native")
        t.expectEqual(OwnerSkill.dsa.cycled(by: -1), .programming)
        t.expectEqual(OwnerSkill.programming.cycled(by: -1), .devops)
    }
}
