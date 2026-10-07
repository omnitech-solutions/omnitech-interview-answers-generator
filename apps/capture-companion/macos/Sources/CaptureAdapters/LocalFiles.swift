import CaptureCore
import Foundation

// [DOMAIN] Small local state in the user's Application Support directory: the
// Studio address and workspace slug chosen at pairing (neither is a secret), a
// pid file so `stop` can reach the running process, and the "stopped locally"
// marker. Never audio, text, images or the credential.
public struct CompanionPaths {
    public let directory: URL

    public init(directory: URL? = nil) {
        self.directory =
            directory
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OmnitechCaptureCompanion", isDirectory: true)
    }

    public var pidFile: URL { directory.appendingPathComponent("run.pid") }
    public var stopMarker: URL { directory.appendingPathComponent("stopped-locally.json") }
    public var pairing: URL { directory.appendingPathComponent("pairing.json") }

    public func prepare() throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
    }
}

public struct StopMarkerFile: StopMarkerStore {
    private let paths: CompanionPaths

    public init(paths: CompanionPaths) { self.paths = paths }

    public func persistStoppedLocally(at time: Date) throws {
        try paths.prepare()
        let body = #"{"stoppedLocally":true,"at":"\#(TimeText.iso(time))"}"#
        try Data(body.utf8).write(to: paths.stopMarker, options: .atomic)
    }

    public func clear() { try? FileManager.default.removeItem(at: paths.stopMarker) }
    public func isPresent() -> Bool { FileManager.default.fileExists(atPath: paths.stopMarker.path) }
}

public struct PairingRecord: Codable, Equatable {
    public let studioAddress: String
    public let tenantSlug: String

    public init(studioAddress: String, tenantSlug: String) {
        self.studioAddress = studioAddress
        self.tenantSlug = tenantSlug
    }

    public static func load(from paths: CompanionPaths) -> PairingRecord? {
        guard let data = try? Data(contentsOf: paths.pairing) else { return nil }
        return try? JSONDecoder().decode(PairingRecord.self, from: data)
    }

    public func save(to paths: CompanionPaths) throws {
        try paths.prepare()
        try JSONEncoder().encode(self).write(to: paths.pairing, options: .atomic)
    }
}

public struct RunPidFile {
    private let paths: CompanionPaths

    public init(paths: CompanionPaths) { self.paths = paths }

    public func write() throws {
        try paths.prepare()
        try Data("\(ProcessInfo.processInfo.processIdentifier)".utf8).write(to: paths.pidFile, options: .atomic)
    }

    public func remove() { try? FileManager.default.removeItem(at: paths.pidFile) }

    // The pid of a live companion process, or nil (stale files are ignored).
    public func runningPid() -> Int32? {
        guard let text = try? String(contentsOf: paths.pidFile, encoding: .utf8),
            let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)),
            kill(pid, 0) == 0
        else { return nil }
        return pid
    }
}
