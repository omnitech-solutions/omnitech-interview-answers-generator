import Foundation

// [DOMAIN] What the companion shows the person, derived from facts rather than
// set freely, so a revoked permission can never read as "listening".

public enum CompanionState: String, Equatable, Sendable {
    case idle
    case listening
    case paused
    case sourceLost = "source-lost"
    case permissionRevoked = "permission-revoked"
    case speechUnavailable = "speech-unavailable"
    case stoppedLocally = "stopped-locally"
    case ended
    case credentialRefused = "credential-refused"
}

public enum SourceStatus: Equatable, Sendable {
    case pending
    case running
    case pausedByStudio
    case lost
    case revoked
    // Studio refused this source: dropped for the run, never retried.
    case refused
    case stopped
}

public final class CompanionStateMachine {
    // [INVARIANT] The selection is fixed by the person at start. Nothing the
    // wire can say adds a source: every transition below only narrows it.
    public let selection: Set<CaptureSource>
    public private(set) var statuses: [CaptureSource: SourceStatus]
    public private(set) var studioPaused = false
    public private(set) var speechFailure: SpeechFailure?
    private var terminal: CompanionState?

    public init(selection: Set<CaptureSource>) {
        self.selection = selection
        self.statuses = Dictionary(uniqueKeysWithValues: selection.map { ($0, .pending) })
    }

    public var isTerminal: Bool { terminal != nil }

    // [DOMAIN] Priority: a terminal state wins, then a failed capability, then
    // Studio's pause, then a revoked permission, then a lost source, and only
    // then "listening".
    public var state: CompanionState {
        if let terminal { return terminal }
        if speechFailure != nil { return .speechUnavailable }
        if studioPaused { return .paused }
        let values = Array(statuses.values)
        if values.contains(.revoked) { return .permissionRevoked }
        if values.contains(.lost) { return .sourceLost }
        if values.contains(.running) { return .listening }
        return .idle
    }

    // True while any selected source is actually being captured. A LOST source
    // (device gone, recogniser error) is a visible problem but does not stop the
    // others: the microphone keeps the session live when application audio drops.
    // A revoked permission, a failed capability, Studio's pause and a terminal
    // state still stop everything (`state` ranks them above a running source).
    public var isCapturing: Bool {
        state == .listening || (state == .sourceLost && statuses.values.contains(.running))
    }

    public func running() -> [CaptureSource] {
        selection.filter { statuses[$0] == .running }.sorted { $0.rawValue < $1.rawValue }
    }

    // MARK: transitions (all ignored once terminal)

    public func capabilityFailed(_ failure: SpeechFailure) {
        CompanionEvents.record(.system, "capability.failed", ["failure": "\(failure)"])
        guard !isTerminal else { return }
        speechFailure = failure
    }

    // Returns false when the source may not start: not selected, already
    // refused or revoked, or the run is over.
    @discardableResult
    public func markRunning(_ source: CaptureSource) -> Bool {
        guard !isTerminal, speechFailure == nil, selection.contains(source) else { return false }
        switch statuses[source] {
        case .refused, .revoked, .lost: return false
        default:
            statuses[source] = .running
            return true
        }
    }

    public func markLost(_ source: CaptureSource, reason: DisconnectReason) {
        CompanionEvents.record(.system, "source.lost", ["source": "\(source)", "reason": "\(reason)"])
        guard !isTerminal, selection.contains(source), statuses[source] != .refused else { return }
        statuses[source] = reason == .permissionRevoked ? .revoked : .lost
    }

    public func refuse(_ source: CaptureSource) {
        CompanionEvents.record(.server, "source.refused", ["source": "\(source)"])
        guard !isTerminal, selection.contains(source) else { return }
        statuses[source] = .refused
    }

    // Studio paused the session: every running source waits for resume.
    public func pauseByStudio() {
        guard !isTerminal else { return }
        studioPaused = true
        for source in selection where statuses[source] == .running { statuses[source] = .pausedByStudio }
    }

    // [GUARD] Resume returns only sources this person selected, that Studio
    // paused (not lost, revoked or refused); the caller restarts exactly these.
    public func resumeByStudio() -> [CaptureSource] {
        guard !isTerminal, studioPaused else { return [] }
        studioPaused = false
        return selection.filter { statuses[$0] == .pausedByStudio }.sorted { $0.rawValue < $1.rawValue }
    }

    public func markStopped(_ source: CaptureSource) {
        guard !isTerminal, statuses[source] == .running else { return }
        statuses[source] = .stopped
    }

    // Terminal states: the first one wins and the run is over.
    public func stopLocally() { terminate(.stoppedLocally) }
    public func endByStudio() { terminate(.ended) }
    public func refuseCredential() { terminate(.credentialRefused) }

    private func terminate(_ state: CompanionState) {
        CompanionEvents.record(.system, "run.terminal", ["state": "\(state)"])
        guard terminal == nil else { return }
        terminal = state
        for source in selection where statuses[source] == .running || statuses[source] == .pausedByStudio {
            statuses[source] = .stopped
        }
    }
}
