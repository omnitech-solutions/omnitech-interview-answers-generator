import CaptureCore
import Foundation
import os

// The one entry point for everything the native app records about itself:
// a menu item pressed (user), a command from the page (page), a heartbeat sent
// (heartbeat), an acknowledgement or control state read (server), and the
// engine's or a source's own state changes (system). Every event is a short
// name plus string fields that are codes and ids; the redaction below drops
// anything that looks like a credential or content before a line leaves the
// process, so a careless caller cannot leak either.
//
// Configuration is read from the environment once (see `EventLogConfig`):
//   STUDIO_LOG_LEVEL          error | warn | info | debug | trace   (default info)
//   STUDIO_EVENT_LOG          off | unified | file | both           (default both)
//   STUDIO_EVENT_LOG_PATH     JSON-lines file (default ~/Library/Logs/Interview Studio/events.jsonl)
//   STUDIO_EVENT_LOG_MAX_BYTES  rotate the file past this size (default 5 MB)
// The unified log is read with `log show --predicate 'subsystem == "com.omnitech.studio-shell"'`.

public enum LogLevel: Int, Comparable, Sendable {
    case error = 0, warn, info, debug, trace

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool { lhs.rawValue < rhs.rawValue }

    public init?(name: String) {
        switch name.lowercased() {
        case "error": self = .error
        case "warn", "warning": self = .warn
        case "info": self = .info
        case "debug": self = .debug
        case "trace": self = .trace
        default: return nil
        }
    }

    var label: String {
        switch self {
        case .error: return "error"
        case .warn: return "warn"
        case .info: return "info"
        case .debug: return "debug"
        case .trace: return "trace"
        }
    }
}

public enum LogOrigin: String, Sendable, CaseIterable {
    case user, page, heartbeat, server, system
}

public struct LogEvent: Equatable, Sendable {
    public let time: Date
    public let level: LogLevel
    public let origin: LogOrigin
    public let name: String
    public let fields: [String: String]
}

public struct EventLogConfig: Equatable, Sendable {
    public var level: LogLevel
    public var unified: Bool
    public var file: URL?
    public var maxFileBytes: Int

    public static let defaultFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/Interview Studio/events.jsonl")

    public init(level: LogLevel = .info, unified: Bool = true, file: URL? = defaultFile, maxFileBytes: Int = 5_000_000)
    {
        self.level = level
        self.unified = unified
        self.file = file
        self.maxFileBytes = maxFileBytes
    }

    // Outside an app bundle (tests, command-line runs) the file is off unless
    // asked for, so a test run never writes under ~/Library/Logs.
    public static func fromEnvironment(
        _ env: [String: String] = ProcessInfo.processInfo.environment,
        inBundle: Bool = Bundle.main.bundleIdentifier != nil
    ) -> EventLogConfig {
        var config = EventLogConfig(file: inBundle ? defaultFile : nil)
        if let level = env["STUDIO_LOG_LEVEL"].flatMap(LogLevel.init(name:)) { config.level = level }
        switch env["STUDIO_EVENT_LOG"]?.lowercased() {
        case "off":
            config.unified = false
            config.file = nil
        case "unified": config.file = nil
        case "file":
            config.unified = false
            config.file = defaultFile
        case "both": config.file = defaultFile
        default: break
        }
        if let path = env["STUDIO_EVENT_LOG_PATH"], !path.isEmpty, config.file != nil {
            config.file = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        }
        if let bytes = env["STUDIO_EVENT_LOG_MAX_BYTES"].flatMap({ Int($0) }), bytes > 0 { config.maxFileBytes = bytes }
        return config
    }
}

public protocol LogSink: Sendable {
    func write(_ line: String, event: LogEvent)
}

public final class EventLog: @unchecked Sendable {
    public static let shared = EventLog(config: .fromEnvironment())

    public let config: EventLogConfig
    private let sinks: [LogSink]
    private let clock: @Sendable () -> Date
    private let lock = NSLock()
    private var ring: [LogEvent] = []
    private let ringLimit = 64

    public init(config: EventLogConfig, clock: @escaping @Sendable () -> Date = Date.init, sinks: [LogSink]? = nil) {
        self.config = config
        self.clock = clock
        if let sinks {
            self.sinks = sinks
        } else {
            var built: [LogSink] = []
            if config.unified { built.append(UnifiedLogSink()) }
            if let file = config.file { built.append(FileLogSink(url: file, maxBytes: config.maxFileBytes)) }
            self.sinks = built
        }
    }

    // The entry point. Fields are redacted here; `level` defaults to info.
    public func record(_ origin: LogOrigin, _ name: String, _ fields: [String: String] = [:], level: LogLevel = .info) {
        guard level <= config.level else { return }
        let event = LogEvent(
            time: clock(), level: level, origin: origin, name: Self.safeName(name), fields: Self.redact(fields))
        lock.lock()
        ring.append(event)
        if ring.count > ringLimit { ring.removeFirst(ring.count - ringLimit) }
        lock.unlock()
        let line = Self.encode(event)
        for sink in sinks { sink.write(line, event: event) }
    }

    // The last events, newest last: what a diagnostics report or a bug reporter shows.
    public func recent(_ limit: Int = 32) -> [LogEvent] {
        lock.lock()
        defer { lock.unlock() }
        return Array(ring.suffix(limit))
    }

    // MARK: redaction

    // A key that names a credential or content is dropped; a value that is not
    // a code or id (letters, digits and a little punctuation) is replaced.
    private static let deniedKeyParts = [
        "token", "secret", "credential", "authorization", "cookie", "password", "text", "transcript", "prompt",
        "question", "answer", "note", "base64", "payload",
    ]
    private static let valueCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " _.:/@()+,=-"))
    private static let nameCharacters = CharacterSet.lowercaseLetters.union(.decimalDigits).union(
        CharacterSet(charactersIn: "_.:-"))

    static func isDeniedKey(_ key: String) -> Bool {
        let lower = key.lowercased()
        return deniedKeyParts.contains { lower.contains($0) }
    }

    static func isSafeValue(_ value: String) -> Bool {
        value.count <= 160 && value.unicodeScalars.allSatisfy { valueCharacters.contains($0) }
    }

    public static func redact(_ fields: [String: String]) -> [String: String] {
        var out: [String: String] = [:]
        for (key, value) in fields where !isDeniedKey(key) {
            out[key] = isSafeValue(value) ? value : "[redacted]"
        }
        return out
    }

    static func safeName(_ name: String) -> String {
        let fits = !name.isEmpty && name.count <= 64 && name.unicodeScalars.allSatisfy { nameCharacters.contains($0) }
        return fits ? name : "invalid_name"
    }

    // MARK: encoding (one JSON object per line, keys sorted so lines diff well)

    // A formatter per line: the type is not Sendable and the log is not hot.
    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    public static func encode(_ event: LogEvent) -> String {
        var object: [String: Any] = [
            "time": iso(event.time),
            "level": event.level.label,
            "origin": event.origin.rawValue,
            "event": event.name,
        ]
        if !event.fields.isEmpty { object["fields"] = event.fields }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
            let line = String(data: data, encoding: .utf8)
        else { return #"{"event":"encode_failed"}"# }
        return line
    }
}

// Apple's unified log, one category per origin, public strings: the fields
// were redacted before they got here and the log is the owner's own machine.
final class UnifiedLogSink: LogSink {
    private let loggers: [LogOrigin: Logger] = Dictionary(
        uniqueKeysWithValues: LogOrigin.allCases.map {
            ($0, Logger(subsystem: "com.omnitech.studio-shell", category: $0.rawValue))
        })

    func write(_ line: String, event: LogEvent) {
        guard let logger = loggers[event.origin] else { return }
        switch event.level {
        case .error: logger.error("\(line, privacy: .public)")
        case .warn: logger.warning("\(line, privacy: .public)")
        case .info: logger.info("\(line, privacy: .public)")
        case .debug, .trace: logger.debug("\(line, privacy: .public)")
        }
    }
}

// A JSON-lines file that rotates once past `maxBytes` (one previous file kept
// as `<name>.1`). Writes are serialised; a failure to write is dropped, never
// retried: the log must not be able to break the app.
public final class FileLogSink: LogSink, @unchecked Sendable {
    private let url: URL
    private let maxBytes: Int
    private let lock = NSLock()

    public init(url: URL, maxBytes: Int) {
        self.url = url
        self.maxBytes = maxBytes
    }

    public func write(_ line: String, event: LogEvent) {
        guard let data = (line + "\n").data(using: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        let manager = FileManager.default
        try? manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let size = (try? manager.attributesOfItem(atPath: url.path)[.size] as? Int), size + data.count > maxBytes {
            let previous = url.appendingPathExtension("1")
            try? manager.removeItem(at: previous)
            try? manager.moveItem(at: url, to: previous)
        }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            handle.closeFile()
        } else {
            try? data.write(to: url)
        }
    }
}

extension EventLog {
    // The capture companion's events (sources, heartbeats, acknowledgements)
    // arrive through its one hook and are recorded like every other event.
    public func captureCompanionEvents() {
        CompanionEvents.shared.install { [weak self] event in
            self?.record(LogOrigin(rawValue: event.origin.rawValue) ?? .system, event.name, event.fields)
        }
    }
}
