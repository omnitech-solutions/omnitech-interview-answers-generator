import Foundation

// [DOMAIN] Control reaches the companion only as the `control` field of
// acknowledgements and refusals (ADR-0011); the companion holds no control
// credential and there is no push channel. Reading it from every ack is the
// "pull". Control can only NARROW what runs:
//   paused            -> stop sources, drop buffered audio, discard stale content
//   ended / purging   -> stop for good, clear everything
//   credential refused-> stop visibly, delete the stored credential, keep nothing
//   active after pause-> restart only sources the person selected that Studio
//                        paused (never lost, revoked or refused ones)
//   a refused source  -> dropped for the run
public final class ControlPull {
    private let machine: CompanionStateMachine
    private let sources: SourceControl
    private let buffers: [AudioRingBuffer]
    private let outbox: Outbox
    private let credentials: CredentialStore

    public init(
        machine: CompanionStateMachine, sources: SourceControl, buffers: [AudioRingBuffer],
        outbox: Outbox, credentials: CredentialStore
    ) {
        self.machine = machine
        self.sources = sources
        self.buffers = buffers
        self.outbox = outbox
        self.credentials = credentials
    }

    // Reads control out of one acknowledgement. `observation` is the message
    // the ack answers, when there was one (a heartbeat has none).
    public func observe(_ ack: Acknowledgement, answering observation: Observation? = nil) {
        switch ack {
        case .accepted(let accepted):
            CompanionEvents.record(.server, "ack.accepted", ["control": "\(accepted.control.state)"])
        case .refused(let code, let control, _):
            CompanionEvents.record(
                .server, "ack.refused", ["code": "\(code)", "control": control.map { "\($0.state)" } ?? "none"])
        case .duplicate:
            CompanionEvents.record(.server, "ack.duplicate")
        }
        guard !machine.isTerminal else { return }
        if case .refused(let code, _, let issues) = ack {
            switch code {
            case .credentialRefused:
                refuseCredential()
                return
            case .sessionEnded, .sessionPurging:
                end()
                return
            case .sessionPaused:
                pause()
            case .invalidObservation:
                if let observation, namesSource(issues) { dropRefusedSource(observation.captureSource) }
            default: break
            }
        }
        if let control = ack.control { apply(control.state) }
    }

    // Credential expiry is decided locally from the last control status.
    public func credentialExpired() {
        guard !machine.isTerminal else { return }
        refuseCredential()
    }

    private func apply(_ state: ControlState) {
        switch state {
        case .active: resume()
        case .paused: pause()
        case .ended, .purging: end()
        }
    }

    private func pause() {
        guard !machine.studioPaused else { return }
        machine.pauseByStudio()
        for source in machine.selection { sources.stop(source) }
        for buffer in buffers { buffer.drop(reason: .paused) }
        outbox.discardContent()
    }

    private func resume() {
        for source in machine.resumeByStudio() {
            if machine.markRunning(source) { sources.start(source) }
        }
    }

    private func end() {
        machine.endByStudio()
        stopEverything(reason: .stopped)
        outbox.clear()
    }

    private func refuseCredential() {
        machine.refuseCredential()
        stopEverything(reason: .credentialExpired)
        outbox.clear()
        // [SAFETY] "Keeps nothing": a failed delete is not retried or logged.
        try? credentials.delete()
    }

    private func stopEverything(reason: AudioDropReason) {
        for source in machine.selection { sources.stop(source) }
        for buffer in buffers { buffer.drop(reason: reason) }
    }

    // [GUARD] A permanent refusal drops a whole source only when Studio said the
    // source itself was the problem; any other invalid message is just dropped.
    private func namesSource(_ issues: [AckIssue]?) -> Bool {
        issues?.contains { $0.path.contains(.key("source")) } ?? false
    }

    private func dropRefusedSource(_ source: CaptureSource) {
        machine.refuse(source)
        sources.stop(source)
        if source != .screen { for buffer in buffers { buffer.drop(reason: .sourceLost) } }
    }
}
