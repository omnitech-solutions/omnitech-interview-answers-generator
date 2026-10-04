import Foundation

// [DOMAIN] The menu's "Switch session" and "Pause/Resume" are a remote control
// for routes Studio already serves to its own page. The shell asks the web view
// to call them with the person's own sign-in and renders what comes back; it
// keeps no session state and decides nothing. A summary carries no content: an
// id, a status and a start time.
public struct SessionChoice: Equatable, Sendable {
    public let id: String
    public let status: String
    public let createdAt: Date?

    public var isOpen: Bool { status == "active" || status == "paused" || status == "created" }
    public var isPaused: Bool { status == "paused" }

    // "Live · 14:03" or "Paused · 14:03"; never a title.
    public func menuTitle(timeZone: TimeZone = .current) -> String {
        let state = status == "paused" ? "Paused" : status == "active" ? "Live" : status.capitalized
        guard let createdAt else { return state }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = timeZone
        return "\(state) · \(formatter.string(from: createdAt))"
    }
}

public enum SessionChoices {
    // GET .../sessions -> { sessions: [{ id, status, createdAt, … }], nextCursor }
    // Open sessions only, newest first, at most `limit`; a malformed row is dropped.
    public static func parseList(_ json: String, limit: Int = 8) -> [SessionChoice] {
        guard let data = json.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let rows = root["sessions"] as? [[String: Any]]
        else { return [] }
        return rows.compactMap(choice).filter { $0.isOpen }.prefix(limit).map { $0 }
    }

    // GET .../sessions/current -> { session: { id, status, … } }
    public static func parseCurrent(_ json: String) -> SessionChoice? {
        guard let data = json.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let row = root["session"] as? [String: Any]
        else { return nil }
        return choice(row)
    }

    private static func choice(_ row: [String: Any]) -> SessionChoice? {
        guard let id = row["id"] as? String, StudioLocation.isSessionId(id), let status = row["status"] as? String
        else { return nil }
        let created = (row["createdAt"] as? String).flatMap { text -> Date? in
            let fraction = ISO8601DateFormatter()
            fraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
        }
        return SessionChoice(id: id, status: status, createdAt: created)
    }

    // The body of POST .../sessions/:id/control, as the frontend sends it.
    public static func controlBody(pause: Bool) -> String {
        #"{"version":1,"kind":"session.control","action":"\#(pause ? "pause" : "resume")"}"#
    }
}
