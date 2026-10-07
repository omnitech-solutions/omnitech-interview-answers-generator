import CaptureCore
import Foundation
import StudioShellCore

// A sink that keeps what it was given, for the assertions.
private final class MemorySink: LogSink, @unchecked Sendable {
    var lines: [String] = []
    var events: [LogEvent] = []
    func write(_ line: String, event: LogEvent) {
        lines.append(line)
        events.append(event)
    }
}

@MainActor
func eventLogTests(_ t: Harness) async {
    await t.test("configuration comes from the environment, with safe defaults") {
        let defaults = EventLogConfig.fromEnvironment([:], inBundle: true)
        t.expectEqual(defaults.level, .info)
        t.expect(defaults.unified && defaults.file != nil, "both sinks by default")
        t.expectEqual(defaults.file?.lastPathComponent, "events.jsonl")
        t.expect(EventLogConfig.fromEnvironment([:], inBundle: false).file == nil, "no file outside a bundle")
        t.expect(EventLogConfig.fromEnvironment(["STUDIO_EVENT_LOG": "both"], inBundle: false).file != nil)

        let tuned = EventLogConfig.fromEnvironment([
            "STUDIO_LOG_LEVEL": "trace", "STUDIO_EVENT_LOG": "file",
            "STUDIO_EVENT_LOG_PATH": "/tmp/studio-events.jsonl", "STUDIO_EVENT_LOG_MAX_BYTES": "1234",
        ])
        t.expectEqual(tuned.level, .trace)
        t.expect(!tuned.unified)
        t.expectEqual(tuned.file?.path, "/tmp/studio-events.jsonl")
        t.expectEqual(tuned.maxFileBytes, 1234)

        let off = EventLogConfig.fromEnvironment(["STUDIO_EVENT_LOG": "off", "STUDIO_LOG_LEVEL": "nonsense"])
        t.expect(!off.unified && off.file == nil)
        t.expectEqual(off.level, .info, "an unknown level keeps the default")
    }

    await t.test("an event is one JSON line with its origin, name and redacted fields") {
        let sink = MemorySink()
        let fixed = Date(timeIntervalSince1970: 1_790_000_000)
        let log = EventLog(config: EventLogConfig(level: .info), clock: { fixed }, sinks: [sink])
        log.record(
            .server, "ack.refused",
            [
                "code": "rate_limited", "control": "active",
                "token": "abc", "transcript": "hello there", "authorization": "Bearer x",
                "free": "a line with a newline\nin it", "ok": "sourceLost",
            ])
        t.expectEqual(sink.events.count, 1)
        let fields = sink.events[0].fields
        t.expectEqual(fields["code"], "rate_limited")
        t.expectEqual(fields["ok"], "sourceLost")
        t.expect(
            fields["token"] == nil && fields["transcript"] == nil && fields["authorization"] == nil,
            "denied keys dropped")
        t.expectEqual(fields["free"], "[redacted]", "a value that is not a code is replaced")
        t.expect(sink.lines[0].hasPrefix(#"{"event":"ack.refused","fields":{"#), sink.lines[0])
        t.expect(sink.lines[0].contains(#""origin":"server""#) && sink.lines[0].contains(#""level":"info""#))
        t.expect(sink.lines[0].contains("2026-"), "ISO time")
    }

    await t.test("the level gate drops quieter events; a bad name is never written as given") {
        let sink = MemorySink()
        let log = EventLog(config: EventLogConfig(level: .info), sinks: [sink])
        log.record(.system, "engine.state", level: .debug)
        log.record(.system, "engine.state", level: .trace)
        t.expectEqual(sink.events.count, 0, "debug and trace are below info")
        log.record(.user, "Menu Pause!", level: .error)
        t.expectEqual(sink.events.last?.name, "invalid_name")
        t.expectEqual(log.recent().count, 1, "the ring holds what was recorded")
    }

}

@MainActor
func eventLogSinkTests(_ t: Harness) async {
    await t.test("the file sink appends JSON lines and rotates once past the cap") {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("event-log-\(UUID().uuidString)")
        let url = dir.appendingPathComponent("events.jsonl")
        let sink = FileLogSink(url: url, maxBytes: 200)
        let log = EventLog(config: EventLogConfig(level: .info), sinks: [sink])
        for index in 0..<6 { log.record(.heartbeat, "heartbeat", ["n": "\(index)", "capturing": "true"]) }
        let current = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let previous = (try? String(contentsOf: url.appendingPathExtension("1"), encoding: .utf8)) ?? ""
        t.expect(!current.isEmpty && !previous.isEmpty, "both files exist after rotation")
        let lines = (current + previous).split(separator: "\n")
        t.expect(lines.allSatisfy { $0.hasPrefix("{") && $0.hasSuffix("}") }, "every line is one JSON object")
        t.expect(((try? Data(contentsOf: url).count) ?? 0) <= 200 + 120, "the current file stays near the cap")
        try? FileManager.default.removeItem(at: dir)
    }

    await t.test("the companion's events arrive through its hook with their origin kept") {
        let sink = MemorySink()
        let log = EventLog(config: EventLogConfig(level: .info), sinks: [sink])
        log.captureCompanionEvents()
        CompanionEvents.record(.heartbeat, "heartbeat", ["capturing": "false", "state": "sourceLost"])
        CompanionEvents.shared.install(nil)
        t.expectEqual(sink.events.last?.origin, .heartbeat)
        t.expectEqual(sink.events.last?.fields["state"], "sourceLost")
    }
}
