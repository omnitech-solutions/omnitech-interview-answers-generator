import Foundation

// The one place the companion says what happened to it: a source lost, a run
// ended, an acknowledgement read, a heartbeat sent. CaptureCore itself never
// logs (it keeps nothing); the host installs a sink that decides where an event
// goes and redacts it on the way. Events carry codes and ids only, never
// content, and name their origin so a reader can tell a person's action from a
// heartbeat or Studio's control.
public enum EventOrigin: String, Sendable {
    case user, page, heartbeat, server, system
}

public struct CompanionEvent: Equatable, Sendable {
    public let origin: EventOrigin
    public let name: String
    public let fields: [String: String]

    public init(origin: EventOrigin, name: String, fields: [String: String] = [:]) {
        self.origin = origin
        self.name = name
        self.fields = fields
    }
}

public final class CompanionEvents: @unchecked Sendable {
    public static let shared = CompanionEvents()
    private let lock = NSLock()
    private var sink: (@Sendable (CompanionEvent) -> Void)?

    // The host's one entry: nil (the default) means nothing is recorded.
    public func install(_ sink: (@Sendable (CompanionEvent) -> Void)?) {
        lock.lock()
        self.sink = sink
        lock.unlock()
    }

    public static func record(_ origin: EventOrigin, _ name: String, _ fields: [String: String] = [:]) {
        shared.lock.lock()
        let sink = shared.sink
        shared.lock.unlock()
        sink?(CompanionEvent(origin: origin, name: name, fields: fields))
    }
}
