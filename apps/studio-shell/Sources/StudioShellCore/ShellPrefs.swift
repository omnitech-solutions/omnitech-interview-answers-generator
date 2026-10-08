import CaptureCore
import Foundation

// [DOMAIN] What the shell remembers between launches: interaction mode, the
// app mode and where each window sits. Behind a tiny store so the rules are
// tested without UserDefaults. Nothing here is content.
public protocol SettingsStore {
    func string(forKey key: String) -> String?
    func set(_ value: String?, forKey key: String)
}

// [DOMAIN] Interaction mode. ON (the default): the windows take clicks, so they can
// be moved and used. OFF: every window is click-through so the page underneath
// keeps the mouse. The shell owns it, persists it and mirrors it to the pages; the
// dot says which it is. (It defaulted to OFF at first, which made every window inert.)
public struct InteractionState: Equatable, Sendable {
    public enum Dot: String, Sendable { case green, red }

    public private(set) var isInteractive: Bool

    public init(isInteractive: Bool = true) { self.isInteractive = isInteractive }

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

    public var toast: Toast { ToastText.interaction(isInteractive) }
}

// [DOMAIN] A native toast: a large headline and a smaller line under it.
public struct Toast: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public init(_ title: String, _ subtitle: String) {
        self.title = title
        self.subtitle = subtitle
    }
}

// The exact words of the reference video's toasts.
public enum ToastText {
    public static func interaction(_ on: Bool) -> Toast {
        on
            ? Toast("Interaction Mode: ON", "Green dot, Interact with window like scroll, copy, move")
            : Toast("Interaction Mode: OFF", "Red dot shows interaction mode is off")
    }
    public static let recording = Toast("Start/Stop Recording", "option + R")
}

// Where a toast sits: bottom-left of the display, as wide as its gradient.
public enum ToastLayout {
    public static let seconds = 3.0
    public static let padding = 28.0
    public static let height = 100.0
    public static let bottomInset = 48.0

    public static func frame(on screen: CGRect) -> CGRect {
        CGRect(x: screen.minX, y: screen.minY + bottomInset, width: min(900, screen.width * 0.6), height: height)
    }
}

// [DOMAIN] First-run consent. The person confirms once, natively, that everyone
// in the conversation agrees to recording and AI assistance; until then the
// pages must start nothing. The flag the pages read is `studio.shell.consented`
// in localStorage, set for the Studio origin before any page script runs.
public enum Consent {
    public static let prompt =
        "Everyone in this conversation agrees to it being recorded and to using AI assistance. Continue?"
    public static let storageKey = "studio.shell.consented"
    static let prefKey = "consent.v1"

    public static func isGranted(_ store: SettingsStore) -> Bool { store.string(forKey: prefKey) == "1" }
    public static func grant(_ store: SettingsStore) { store.set("1", forKey: prefKey) }

    // The document-start script, only when consent was given: nothing otherwise.
    public static func pageScript(_ store: SettingsStore) -> String? {
        isGranted(store) ? "try { localStorage.setItem(\"\(storageKey)\", \"1\"); } catch (e) {}" : nil
    }
}

public struct ShellPrefs {
    private let store: SettingsStore

    public init(store: SettingsStore) { self.store = store }

    public var interaction: InteractionState {
        // "interactive2": an earlier build persisted OFF as its default; start fresh.
        get { InteractionState(isInteractive: store.string(forKey: "interactive2") != "0") }
        nonmutating set { store.set(newValue.isInteractive ? "1" : "0", forKey: "interactive2") }
    }

    public var appMode: AppMode {
        // "appMode2": the default is the compact window, not the main window.
        get { store.string(forKey: "appMode2").flatMap(AppMode.init(rawValue:)) ?? .minified }
        nonmutating set { store.set(newValue.rawValue, forKey: "appMode2") }
    }

    // The display capture is pinned to; nil follows the last-focused browser.
    public var captureDisplay: UInt32? {
        get { store.string(forKey: "capture.display").flatMap { UInt32($0) } }
        nonmutating set { store.set(newValue.map { String($0) }, forKey: "capture.display") }
    }

    // How the call's audio is captured. Absent or unreadable is the default
    // (ScreenCaptureKit), so an existing install behaves exactly as before.
    public var callAudio: CallAudioSource {
        get { CallAudioSource.parse(store.string(forKey: "audio.callSource")) }
        nonmutating set { store.set(newValue.rawValue, forKey: "audio.callSource") }
    }

    // The compact window and Settings each remember where they were put.
    public func savedFrame(_ kind: WindowKind, displays: [CGRect]) -> CGRect? {
        PanelFrameCodec.restoreFrame(
            store.string(forKey: Self.frameKey(kind)), minSize: kind.minSize, displays: displays)
    }

    public func saveFrame(_ kind: WindowKind, _ frame: CGRect) {
        store.set(PanelFrameCodec.encode(frame), forKey: Self.frameKey(kind))
    }

    public func frame(_ kind: WindowKind, displays: [CGRect], main: CGRect) -> CGRect {
        savedFrame(kind, displays: displays) ?? PanelLayout.defaultFrame(kind, in: main)
    }

    private static func frameKey(_ kind: WindowKind) -> String {
        kind == .compact ? "shell.compact.frame" : "panel.settings.frame2"
    }

    // The expanded main window's frame.
    public static let mainWindowMinSize = CGSize(width: 800, height: 520)

    public func mainWindowFrame(displays: [CGRect], main: CGRect) -> CGRect {
        let saved = PanelFrameCodec.restoreFrame(
            store.string(forKey: "main.frame"), minSize: Self.mainWindowMinSize, displays: displays)
        let size = CGSize(width: min(1280, main.width * 0.85), height: min(860, main.height * 0.85))
        let centered = CGRect(
            x: main.midX - size.width / 2, y: main.midY - size.height / 2, width: size.width, height: size.height)
        return saved ?? PanelLayout.fit(centered, in: main, min: Self.mainWindowMinSize)
    }

    public func saveMainWindowFrame(_ frame: CGRect) {
        store.set(PanelFrameCodec.encode(frame), forKey: "main.frame")
    }
}
