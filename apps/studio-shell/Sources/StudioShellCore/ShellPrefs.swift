import Foundation

// [DOMAIN] What the shell remembers between launches: interaction mode, the
// current skill, the layout, which panels are shown and where. Behind a tiny
// store so the rules are tested without UserDefaults. Nothing here is content.
public protocol SettingsStore {
    func string(forKey key: String) -> String?
    func set(_ value: String?, forKey key: String)
}

public enum LayoutMode: String, Sendable {
    // The four floating panels (default).
    case panels
    // The single compact window, the fallback.
    case compact
}

// [DOMAIN] Interaction mode. OFF (the default): every panel is click-through so
// the page underneath keeps the mouse. ON: panels take clicks. The shell owns
// it, persists it and mirrors it to the pages; the dot says which it is.
public struct InteractionState: Equatable, Sendable {
    public enum Dot: String, Sendable { case green, red }

    public private(set) var isInteractive: Bool

    public init(isInteractive: Bool = false) { self.isInteractive = isInteractive }

    public var ignoresMouseEvents: Bool { !isInteractive }
    public var dot: Dot { isInteractive ? .green : .red }

    // Returns whether it changed.
    @discardableResult
    public mutating func set(_ on: Bool) -> Bool {
        guard on != isInteractive else { return false }
        isInteractive = on
        return true
    }

    public mutating func toggle() { isInteractive.toggle() }

    public var toast: String {
        isInteractive
            ? "Interaction Mode: ON — green dot: panels take clicks"
            : "Interaction Mode: OFF — red dot shows interaction mode is off"
    }
}

public enum ToastText {
    public static func skillChanged(_ skill: OwnerSkill) -> String { "Skill changed to \(skill.label)" }
    public static func currentSkill(_ skill: OwnerSkill) -> String { "Current skill \(skill.label) — ⌘↑/⌘↓" }
}

public struct ShellPrefs {
    private let store: SettingsStore

    public init(store: SettingsStore) { self.store = store }

    public var interaction: InteractionState {
        get { InteractionState(isInteractive: store.string(forKey: "interactive") == "1") }
        nonmutating set { store.set(newValue.isInteractive ? "1" : "0", forKey: "interactive") }
    }

    public var skill: OwnerSkill {
        get { store.string(forKey: "skill").flatMap(OwnerSkill.init(rawValue:)) ?? .default }
        nonmutating set { store.set(newValue.rawValue, forKey: "skill") }
    }

    public var appMode: AppMode {
        get { store.string(forKey: "appMode").flatMap(AppMode.init(rawValue:)) ?? .expanded }
        nonmutating set { store.set(newValue.rawValue, forKey: "appMode") }
    }

    public var opacity: Double {
        get { store.string(forKey: "opacity").flatMap(Double.init).map(PanelOpacity.clamp) ?? 1 }
        nonmutating set { store.set(String(PanelOpacity.clamp(newValue)), forKey: "opacity") }
    }

    public var layout: LayoutMode {
        get { store.string(forKey: "layout").flatMap(LayoutMode.init(rawValue:)) ?? .panels }
        nonmutating set { store.set(newValue.rawValue, forKey: "layout") }
    }

    public func isVisible(_ kind: PanelKind) -> Bool {
        switch store.string(forKey: "panel.\(kind.rawValue).visible") {
        case "1": true
        case "0": false
        default: kind.startsVisible
        }
    }

    public func setVisible(_ kind: PanelKind, _ visible: Bool) {
        store.set(visible ? "1" : "0", forKey: "panel.\(kind.rawValue).visible")
    }

    public func savedFrame(_ kind: PanelKind, displays: [CGRect]) -> CGRect? {
        PanelFrameCodec.restore(kind, saved: store.string(forKey: "panel.\(kind.rawValue).frame"), displays: displays)
    }

    public func saveFrame(_ kind: PanelKind, _ frame: CGRect) {
        store.set(PanelFrameCodec.encode(frame), forKey: "panel.\(kind.rawValue).frame")
    }

    // The expanded main window's frame (minified frames are per panel).
    public static let mainWindowMinSize = CGSize(width: 800, height: 520)

    public func mainWindowFrame(displays: [CGRect], main: CGRect) -> CGRect {
        let saved = PanelFrameCodec.restoreFrame(
            store.string(forKey: "main.frame"), minSize: Self.mainWindowMinSize, fixedSize: nil, displays: displays)
        let size = CGSize(width: min(1280, main.width * 0.85), height: min(860, main.height * 0.85))
        let centered = CGRect(x: main.midX - size.width / 2, y: main.midY - size.height / 2, width: size.width, height: size.height)
        return saved ?? PanelLayout.fit(centered, in: main, min: Self.mainWindowMinSize)
    }

    public func saveMainWindowFrame(_ frame: CGRect) {
        store.set(PanelFrameCodec.encode(frame), forKey: "main.frame")
    }

    // "Layout reset": forget placement and visibility.
    public func resetLayout() {
        for kind in PanelKind.allCases {
            store.set(nil, forKey: "panel.\(kind.rawValue).frame")
            store.set(nil, forKey: "panel.\(kind.rawValue).visible")
        }
        store.set(nil, forKey: "main.frame")
    }

    public func frame(_ kind: PanelKind, displays: [CGRect], main: CGRect) -> CGRect {
        savedFrame(kind, displays: displays) ?? PanelLayout.defaultFrame(kind, in: main)
    }
}
