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

    public var title: String {
        switch self {
        case .notPaired: "Not connected"
        case .connecting: "Connecting…"
        case .connected: "Connected"
        case .unreachable: "Studio not reachable"
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
    public static func state(paired: Bool, probe: ProbeResult?) -> ConnectionState {
        guard paired else { return .notPaired }
        guard let probe else { return .connecting }
        if case .answered(let status) = probe, status == 200 { return .connected }
        return .unreachable
    }
}

// The one line the window, and the menu, always carry (ADR-0018, no
// concealment): the shell is an ordinary visible window.
public enum VisibilityTruth {
    public static let line = "Visible window · shows in screen shares"
}
