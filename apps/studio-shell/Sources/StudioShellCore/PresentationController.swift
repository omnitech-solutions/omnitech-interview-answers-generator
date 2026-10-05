import Foundation

// [DOMAIN] The presentation interface: how Studio's pages ask a host to lay out
// and reveal its surfaces, platform-neutral like picture-in-picture. Every
// native behaviour (minify/expand, the Settings window, interaction mode, the
// hotkey set) is ONE typed `PresentationCommand`; the page's bridge call, a
// menu item and a hotkey all go through `PresentationController.perform`, so there is
// no native-only path. This module holds no window code; the surface (AppKit)
// only renders the resulting `PresentationState`. Mirrors
// `packages/interview-contracts` (`studio-host`).
enum PresentationCapability: String, CaseIterable, Sendable {
    case alwaysOnTop = "always-on-top"
    case clickThrough = "click-through"
    case allSpaces = "all-spaces"
}

// The standalone app (expanded: the main window) or its minified form (the one
// compact window, with Settings beside it on demand).
public enum AppMode: String, Sendable {
    case expanded, minified

    public var toggled: AppMode { self == .expanded ? .minified : .expanded }
}

public enum PresentationCommand: Equatable, Sendable {
    case openSettings
    case closeSettings
    case setVisible(Bool)
    case toggleVisible
    case setInteractionMode(Bool)
    case toggleInteractionMode
    case setAppMode(AppMode)
    case toggleAppMode
    case setHotkeysEnabled(Bool)
    // The one window: this size (points). It widens or narrows about its centre; a
    // height fits it to its content from the top edge, none restores the old height.
    case setWindowSize(width: Double, height: Double?)
    case bringToFront
    // The Settings window's Quit: ends the app.
    case quitApp
}

public struct PresentationState: Equatable, Sendable {
    public var appMode: AppMode
    // Settings is switched on; what is on screen is `settingsShown`.
    public var settingsOpen: Bool
    public var hidden: Bool
    public var interaction: InteractionState
    public var hotkeysEnabled: Bool

    public static let initial = PresentationState(
        appMode: .expanded, settingsOpen: false, hidden: false,
        interaction: InteractionState(), hotkeysEnabled: true)

    public var mainWindowShown: Bool { appMode == .expanded }
    public var compactShown: Bool { appMode == .minified && !hidden }
    public var settingsShown: Bool { compactShown && settingsOpen }

    // The state as pages read it: names only, never content.
    public var wire: [String: Any] {
        [
            "mode": appMode.rawValue,
            "hidden": hidden,
            "interactive": interaction.isInteractive,
            "hotkeys": hotkeysEnabled,
            // The minified form is a hands-free host: Studio defaults Auto on.
            "handsFree": appMode == .minified,
            // The shell shows the interaction and recording toasts itself.
            "nativeToasts": true,
        ]
    }
}

// The thin platform side: renders a state and executes OS-level actions. The
// native adapter drives NSPanel/NSWindow.
@MainActor
public protocol PresentationSurface: AnyObject {
    func render(_ state: PresentationState)
    func bringToFront()
    func toast(_ toast: Toast)
    func quit()
    // The one-window view: take this size, widening or narrowing evenly about the
    // window's centre so the toolbar at its top stays where it is.
    func setCompactSize(width: Double, height: Double?)
}

// [DOMAIN] The reducer: command -> new state -> persist -> render. All the
// rules live here, tested without a window.
@MainActor
public final class PresentationController {
    public private(set) var state: PresentationState
    private let prefs: ShellPrefs
    public weak var surface: PresentationSurface?
    // Pages are told about every change (the presentation state push).
    public var onChange: (PresentationState) -> Void = { _ in }

    public init(prefs: ShellPrefs) {
        self.prefs = prefs
        // Settings is on demand: it never reopens by itself.
        state = PresentationState(
            appMode: prefs.appMode, settingsOpen: false, hidden: false,
            interaction: prefs.interaction, hotkeysEnabled: true)
    }

    @discardableResult
    public func perform(_ command: PresentationCommand) -> PresentationState {
        let before = state
        var next = state
        var toast: Toast?
        switch command {
        case .openSettings:
            // Settings sits beside the compact window, which exists only in the minified form.
            next.settingsOpen = true
            next.appMode = .minified
            next.hidden = false
            // Settings is for clicking, so it turns interaction ON.
            next.interaction.set(true)
        case .closeSettings:
            next.settingsOpen = false
        case .setVisible(let visible):
            next.hidden = !visible
            if visible { next.appMode = .minified }
        case .toggleVisible:
            next.hidden.toggle()
            if !next.hidden { next.appMode = .minified }
        case .setInteractionMode(let on):
            next.interaction.set(on)
        case .toggleInteractionMode:
            next.interaction.toggle()
        case .setAppMode(let mode):
            next.appMode = mode
            if mode == .minified { next.hidden = false }
        case .toggleAppMode:
            next.appMode = next.appMode.toggled
            if next.appMode == .minified { next.hidden = false }
        case .setHotkeysEnabled(let on):
            next.hotkeysEnabled = on
        case .setWindowSize(let width, let height):
            surface?.setCompactSize(width: width, height: height)
        case .bringToFront, .quitApp:
            break
        }
        if next.interaction != before.interaction { toast = next.interaction.toast }
        state = next
        if next != before {
            prefs.appMode = next.appMode
            prefs.interaction = next.interaction
        }
        surface?.render(next)
        switch command {
        case .bringToFront: surface?.bringToFront()
        case .quitApp: surface?.quit()
        default: break
        }
        if let toast { surface?.toast(toast) }
        if next != before { onChange(next) }
        return next
    }
}
