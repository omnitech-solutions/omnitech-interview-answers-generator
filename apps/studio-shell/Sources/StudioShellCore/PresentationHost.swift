import Foundation

// [DOMAIN] The presentation interface: how Studio's pages ask a host to lay out
// and reveal its surfaces, platform-neutral like picture-in-picture. Every
// native behaviour (minify/expand, panels, layout, interaction mode, the
// hotkey set) is ONE typed `PresentationCommand`; the page's bridge call, a
// menu item and a hotkey all go through `PresentationHost.perform`, so there is
// no native-only path and a PiP adapter can stand in for the macOS one. This
// module holds no window code; the surface (AppKit, or PiP) only renders the
// resulting `PresentationState`. Mirrors `packages/interview-contracts` (`studio-host`).
public enum PresentationCapability: String, CaseIterable, Sendable {
    case multiPanel = "multi-panel"
    case alwaysOnTop = "always-on-top"
    case clickThrough = "click-through"
    case allSpaces = "all-spaces"
}

public enum LayoutPreset: String, CaseIterable, Sendable {
    // The single compact window (the pill plus the active panel, in one).
    case compact
    // The pill and the analysis panel.
    case reading
    // The pill, analysis and chat.
    case all
}

// The standalone app (expanded: the main window) or its minified form (the
// pill and panels, or the compact window).
public enum PanelOpacity {
    public static let minimum = 0.3
    // [GUARD] Never invisible: below the minimum a panel could not be found again.
    public static func clamp(_ value: Double) -> Double { min(1, max(minimum, value.isFinite ? value : 1)) }
}

public enum AppMode: String, Sendable {
    case expanded, minified

    public var toggled: AppMode { self == .expanded ? .minified : .expanded }
}

public enum PresentationCommand: Equatable, Sendable {
    case openPanel(PanelKind)
    case closePanel(PanelKind)
    case focusPanel(PanelKind)
    case setPanelsVisible(Bool)
    case togglePanelsVisible
    case applyLayout(LayoutPreset)
    case resetLayout
    case setInteractionMode(Bool)
    case toggleInteractionMode
    case setAppMode(AppMode)
    case toggleAppMode
    case setHotkeysEnabled(Bool)
    // Panel translucency: 1 opaque, down to PanelOpacity.minimum.
    case setOpacity(Double)
    // The one window: this width (points), widening or narrowing about its centre.
    case setWindowWidth(Double)
    // Placement chrome: keys and pages use the same entries.
    case movePanels(dx: Double, dy: Double)
    case resizePanel(PanelKind, dw: Double, dh: Double)
    case bringToFront
    // The Settings panel's Quit: ends the app.
    case quitApp
}

public struct PresentationState: Equatable, Sendable {
    public var appMode: AppMode
    public var layout: LayoutMode
    // Which panels are switched on; what is on screen is `shownPanels`.
    public var panels: Set<PanelKind>
    public var allHidden: Bool
    public var interaction: InteractionState
    public var hotkeysEnabled: Bool
    public var opacity: Double

    public static let initial = PresentationState(
        appMode: .expanded, layout: .panels, panels: [], allHidden: false,
        interaction: InteractionState(), hotkeysEnabled: true, opacity: 1)

    public var mainWindowShown: Bool { appMode == .expanded }
    public var shownPanels: Set<PanelKind> { appMode == .minified && layout == .panels && !allHidden ? panels : [] }
    public var compactShown: Bool { appMode == .minified && layout == .compact && !allHidden }

    // The state as pages read it: names only, never content.
    public var wire: [String: Any] {
        [
            "mode": appMode.rawValue,
            "layout": layout == .panels ? "panels" : "compact",
            "panels": PanelKind.allCases.filter { shownPanels.contains($0) }.map(\.rawValue),
            "hidden": allHidden,
            "interactive": interaction.isInteractive,
            "hotkeys": hotkeysEnabled,
            "opacity": opacity,
            // The minified form is a hands-free host: Studio defaults Auto on.
            "handsFree": appMode == .minified,
            // The shell shows the interaction/recording/skill toasts itself.
            "nativeToasts": true,
        ]
    }
}

@MainActor
public protocol PresentationHost: AnyObject {
    var presentationCapabilities: [PresentationCapability] { get }
    var state: PresentationState { get }
    @discardableResult
    func perform(_ command: PresentationCommand) -> PresentationState
}

// The thin platform side: renders a state and executes OS-level actions.
// The native adapter drives NSPanel/NSWindow; a PiP adapter would drive a
// picture-in-picture window.
@MainActor
public protocol PresentationSurface: AnyObject {
    func render(_ state: PresentationState)
    func focus(_ panel: PanelKind)
    func resetFrames()
    func movePanels(dx: Double, dy: Double)
    func resizePanel(_ panel: PanelKind, dw: Double, dh: Double)
    func bringToFront()
    func toast(_ toast: Toast)
    func quit()
    // The one-window view: take this width, widening or narrowing evenly about the
    // window's centre so the toolbar at its top stays where it is.
    func setCompactWidth(_ width: Double)
}

extension PresentationSurface {
    public func setCompactWidth(_ width: Double) {}
}

// [DOMAIN] The reducer: command -> new state -> persist -> render. All the
// rules live here, tested without a window.
@MainActor
public final class PresentationController: PresentationHost {
    public let presentationCapabilities = PresentationCapability.allCases
    public private(set) var state: PresentationState
    private let prefs: ShellPrefs
    public weak var surface: PresentationSurface?
    // Pages are told about every change (the presentation state push).
    public var onChange: (PresentationState) -> Void = { _ in }

    public init(prefs: ShellPrefs) {
        self.prefs = prefs
        state = PresentationState(
            appMode: prefs.appMode, layout: prefs.layout,
            // Settings is on demand: it never reopens by itself.
            panels: Set(PanelKind.allCases.filter { $0 != .settings && prefs.isVisible($0) }),
            allHidden: false, interaction: prefs.interaction, hotkeysEnabled: true,
            opacity: prefs.opacity)
    }

    @discardableResult
    public func perform(_ command: PresentationCommand) -> PresentationState {
        let before = state
        var next = state
        var toast: Toast?
        switch command {
        case .openPanel(let kind), .focusPanel(let kind):
            // Panels exist in the minified form: opening one leaves expanded mode.
            next.panels.insert(kind)
            next.appMode = .minified
            next.layout = .panels
            next.allHidden = false
            // Settings is for clicking, so it turns interaction ON.
            if kind == .settings { next.interaction.set(true) }
        case .closePanel(let kind):
            next.panels.remove(kind)
        case .setPanelsVisible(let visible):
            next.allHidden = !visible
            if visible { next.appMode = .minified }
        case .togglePanelsVisible:
            next.allHidden.toggle()
            if !next.allHidden { next.appMode = .minified }
        case .applyLayout(let preset):
            // A layout is only meaningful while minified: it brings the panels forward.
            next.layout = preset == .compact ? .compact : .panels
            switch preset {
            case .compact: break
            case .reading: next.panels = Set<PanelKind>([.pill, .analysis]).union(next.panels.intersection([.settings]))
            case .all: next.panels = Set<PanelKind>([.pill, .analysis, .chat]).union(next.panels.intersection([.settings]))
            }
            next.appMode = .minified
            next.allHidden = false
        case .resetLayout:
            next.panels = Set(PanelKind.allCases.filter(\.startsVisible))
            next.layout = .panels
            next.allHidden = false
        case .setInteractionMode(let on):
            next.interaction.set(on)
        case .toggleInteractionMode:
            next.interaction.toggle()
        case .setAppMode(let mode):
            next.appMode = mode
            if mode == .minified { next.allHidden = false }
        case .toggleAppMode:
            next.appMode = next.appMode.toggled
            if next.appMode == .minified { next.allHidden = false }
        case .setHotkeysEnabled(let on):
            next.hotkeysEnabled = on
        case .setOpacity(let value):
            next.opacity = PanelOpacity.clamp(value)
        case .setWindowWidth(let width):
            if state.layout == .compact { surface?.setCompactWidth(width) }
        case .movePanels, .resizePanel, .bringToFront, .quitApp:
            break
        }
        if next.interaction != before.interaction { toast = next.interaction.toast }
        state = next
        if next != before {
            prefs.appMode = next.appMode
            prefs.layout = next.layout
            prefs.interaction = next.interaction
            prefs.opacity = next.opacity
            for kind in PanelKind.allCases { prefs.setVisible(kind, next.panels.contains(kind)) }
        }
        surface?.render(next)
        switch command {
        case .focusPanel(let kind): surface?.focus(kind)
        case .resetLayout: surface?.resetFrames()
        case .movePanels(let dx, let dy): surface?.movePanels(dx: dx, dy: dy)
        case .resizePanel(let kind, let dw, let dh): surface?.resizePanel(kind, dw: dw, dh: dh)
        case .bringToFront: surface?.bringToFront()
        case .quitApp: surface?.quit()
        default: break
        }
        if let toast { surface?.toast(toast) }
        if next != before { onChange(next) }
        return next
    }
}
