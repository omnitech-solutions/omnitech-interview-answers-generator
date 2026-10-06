import Foundation

// [DOMAIN] What the person sees about the link to Studio. It is derived from
// what the shell can observe without sending content or a credential: whether
// the person has paired, whether Studio answers its public probe, and whether
// the page loaded.
public enum ConnectionState: Equatable, Sendable {
    case notPaired
    case connecting
    case connected
    case unreachable
    // Studio answers, but the web view's own sign-in is missing or expired.
    case signInRequired

    public var title: String {
        switch self {
        case .notPaired: "Not connected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .unreachable: "Studio not reachable"
        case .signInRequired: "Sign in to Studio"
        }
    }

    public var isConnected: Bool { self == .connected }
}

public enum ProbeResult: Equatable, Sendable {
    case answered(status: Int)
    case noAnswer
}

public enum ConnectionRules {
    // A paired shell is connected when Studio's probe answers 200; any other
    // answer or none is unreachable. Before a pairing there is nothing to probe.
    // `signedIn` is the web view's own session (nil: not yet known);
    // `signInAvailable` is whether Studio has a real login provider. The paired
    // capture credential never decides it; only Studio's answer to the page does.
    public static func state(paired: Bool, probe: ProbeResult?, signedIn: Bool? = nil, signInAvailable: Bool? = nil) -> ConnectionState {
        guard paired else { return .notPaired }
        guard let probe else { return .connecting }
        if case .answered(let status) = probe, status == 200 {
            // Prompt only when Studio says signed out AND has a real login
            // provider (nil: not yet known). The default dev user never prompts.
            return signedIn == false && signInAvailable != false ? .signInRequired : .connected
        }
        return .unreachable
    }
}

// The one line the window, and the menu, always carry (ADR-0018, no
// concealment): the shell is an ordinary visible window.
public enum VisibilityTruth {
    public static let line = "Visible window · shows in screen shares"
}

// Which sign-in items the menu-bar menu offers, decided apart from AppKit.
public enum StatusMenuRules {
    // "Sign in to Studio…" shows while Studio says the web view is signed out.
    public static func showsSignIn(_ connection: ConnectionState) -> Bool { connection == .signInRequired }

    // "Sign out" ends this Mac's Studio session, so it is offered only while
    // Studio says someone is signed in (a development Studio that signs every
    // request in still answers 200, so it reads as signed in).
    public static func signOutEnabled(paired: Bool, signedIn: Bool?) -> Bool { paired && signedIn == true }
}
