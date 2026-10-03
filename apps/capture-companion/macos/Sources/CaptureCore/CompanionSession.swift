import Foundation

// [DOMAIN] One companion run: wires the state machine, outbox, control pull,
// stop controller, backoff and transport behind protocols. Adapters push facts
// in (a transcript, a frame, a lost source); `tick()` sends and reads control.
// Confined to the main actor by design: every collaborator below is plain
// single-threaded state that only this actor touches, so no lock or unchecked
// Sendable is needed in Core. Adapter callbacks hop here before calling in.
@MainActor
public final class CompanionSession {
    public let machine: CompanionStateMachine
    public let outbox: Outbox
    public let factory: ObservationFactory
    public let stopController: StopController
    private let pull: ControlPull
    private let endpoint: Endpoint
    private let sources: SourceControl
    private let credentials: CredentialStore
    private let transport: Transport
    private let clock: WallClock
    private let buffers: [AudioRingBuffer]
    private var backoff: Backoff
    private var credentialExpiresAt: Date?
    private var lastHeartbeatAt: Date?
    private var finalHeartbeatSent = false
    public let heartbeatIntervalSeconds: Double

    public init(
        selection: Set<CaptureSource>, runId: String, endpoint: Endpoint, credentials: CredentialStore,
        transport: Transport, clock: WallClock, sources: SourceControl, marker: StopMarkerStore,
        buffers: [AudioRingBuffer], backoff: Backoff, outboxCapacity: Int = 500,
        heartbeatIntervalSeconds: Double = 5
    ) {
        machine = CompanionStateMachine(selection: selection)
        factory = ObservationFactory(runId: runId, clock: clock)
        outbox = Outbox(capacity: outboxCapacity, factory: factory)
        pull = ControlPull(
            machine: machine, sources: sources, buffers: buffers, outbox: outbox, credentials: credentials)
        stopController = StopController(
            machine: machine, sources: sources, buffers: buffers, marker: marker, outbox: outbox,
            factory: factory, clock: clock)
        self.endpoint = endpoint
        self.sources = sources
        self.credentials = credentials
        self.transport = transport
        self.clock = clock
        self.buffers = buffers
        self.backoff = backoff
        self.heartbeatIntervalSeconds = max(heartbeatIntervalSeconds, Double(ActiveSessionLimits.minHeartbeatIntervalMs) / 1000)
    }

    // [GUARD] Starts the selected sources, but only after a passing capability
    // check when any audio source is selected. A failed check is a visible
    // state (speech-unavailable): nothing starts and nothing falls back.
    @discardableResult
    public func start(capability: CapabilityOutcome?) -> Bool {
        let needsSpeech = machine.selection.contains(.microphone) || machine.selection.contains(.applicationAudio)
        if needsSpeech, capability?.failure != nil || capability == nil {
            machine.capabilityFailed(capability?.failure ?? .recognizerUnavailable)
            return false
        }
        for source in machine.selection.sorted(by: { $0.rawValue < $1.rawValue }) where machine.markRunning(source) {
            sources.start(source)
        }
        return true
    }

    // MARK: facts in

    public func submitTranscript(
        source: TranscriptSource, text: String, startMs: Int, endMs: Int, supersedes: String? = nil
    ) -> Observation? {
        guard machine.isCapturing else { return nil }
        let capture: CaptureSource = source == .microphone ? .microphone : .applicationAudio
        // [GUARD] Over-long text is split by the recogniser adapter; here an
        // oversize segment is refused rather than truncated.
        guard text.utf16.count <= ActiveSessionLimits.maxTranscriptTextChars, !text.isEmpty else { return nil }
        let observation = factory.make(
            capture,
            .transcriptFinal(
                TranscriptContent(
                    speaker: source.rawValue, source: source, text: text, startMs: startMs,
                    endMs: max(startMs, endMs), supersedes: supersedes)))
        outbox.enqueue(observation, now: clock.now())
        return observation
    }

    public func submitScreenshot(payload: Data, mediaType: ScreenMediaType, windowLabel: String) -> Observation? {
        guard machine.isCapturing, machine.statuses[.screen] == .running,
            payload.count >= 1, payload.count <= ActiveSessionLimits.maxScreenshotBytes
        else { return nil }
        let reference = "shot-\(factory.runId)-\(outbox.count)-\(Int(clock.now().timeIntervalSince1970 * 1000))"
        let observation = factory.make(
            .screen,
            .screenSnapshot(
                ScreenContent(
                    payloadRef: reference, mediaType: mediaType, byteLength: payload.count,
                    windowLabel: String(windowLabel.prefix(ActiveSessionLimits.maxWindowLabelChars)))))
        outbox.enqueue(observation, payload: payload, now: clock.now())
        return observation
    }

    public func reportAudioOverflow(source: CaptureSource, droppedMs: Int) {
        outbox.enqueue(
            factory.make(source, .captureGap(source: source, durationMs: droppedMs, reason: .bufferOverflow)),
            now: clock.now())
    }

    // [SAFETY] A source the OS took away (permission revoked, device lost) is
    // visible at once and never reads as "listening"; audio is dropped.
    public func sourceLost(_ source: CaptureSource, reason: DisconnectReason) {
        guard !machine.isTerminal else { return }
        machine.markLost(source, reason: reason)
        for buffer in buffers { buffer.drop(reason: reason == .permissionRevoked ? .permissionRevoked : .sourceLost) }
        outbox.enqueue(factory.make(source, .sourceDisconnected(source: source, reason: reason)), now: clock.now())
    }

    public func localStop() { stopController.stopNow() }

    // MARK: sending

    // One pass: expire the credential if due, flush what is due in order, then
    // heartbeat if it is time. Never throws and never logs; failures wait on backoff.
    public func tick() async {
        let now = clock.now()
        if let expires = credentialExpiresAt, now >= expires, !machine.isTerminal {
            pull.credentialExpired()
        }
        guard !machine.isTerminal || machine.state == .stoppedLocally else { return }
        await flush(now: now)
        await heartbeatIfDue(now: now)
    }

    // Sends the capability report once, before any source starts.
    public func sendCapabilityReport(_ report: CapabilityReport) async {
        _ = await send(.capabilityReport(report), payload: nil, answering: nil)
    }

    private func flush(now: Date) async {
        // A local stop sends its notices once and gives up if unreachable.
        let stoppedLocally = machine.state == .stoppedLocally
        var sentThisPass = 0
        while let queued = outbox.next(now: clock.now()), sentThisPass < ActiveSessionLimits.maxIngestPerMinute {
            sentThisPass += 1
            guard let result = await send(.observation(queued.observation), payload: queued.payload, answering: queued.observation)
            else {
                if stoppedLocally { outbox.clear() }
                return
            }
            let outcome = outbox.handle(result.ack, for: queued.observation, retryAfterSeconds: result.retryAfter)
            switch outcome {
            case .delivered: backoff.reset()
            case .droppedPermanent: continue
            case .retryLater(let after):
                let delay = backoff.nextDelay(retryAfterSeconds: after)
                outbox.deferHead(until: clock.now().addingTimeInterval(delay))
                return
            }
        }
    }

    private func heartbeatIfDue(now: Date) async {
        let stoppedLocally = machine.state == .stoppedLocally
        // After a local stop exactly one heartbeat (capturing: false) is attempted.
        if stoppedLocally {
            if finalHeartbeatSent { return }
            finalHeartbeatSent = true
        } else if let last = lastHeartbeatAt, now.timeIntervalSince(last) < heartbeatIntervalSeconds {
            return
        }
        lastHeartbeatAt = now
        // capturing:false asks Studio to pause the session, so it is sent only when the companion itself
        // has stopped. While Studio alone has paused it the companion is doing what it was told and says
        // so; otherwise the owner's resume would be undone by the very next heartbeat.
        let capturing = machine.isCapturing || machine.state == .paused
        let beat = Heartbeat(sourceId: factory.companionId, sentAt: TimeText.iso(now), capturing: capturing)
        _ = await send(.heartbeat(beat), payload: nil, answering: nil)
    }

    // Sends one message and reads control from the answer. Returns nil when
    // there was no usable answer (unreachable, malformed, server error).
    private func send(_ message: IngestMessage, payload: Data?, answering observation: Observation?) async -> (ack: Acknowledgement, retryAfter: Double?)? {
        guard let credential = try? credentials.load(),
            let request = endpoint.request(for: message, payload: payload, credential: credential)
        else {
            // No usable credential stored: nothing can be sent; capture is not continued blindly.
            pull.credentialExpired()
            return nil
        }
        switch await transport.send(request) {
        case .unreachable:
            noteFailure(afterSeconds: nil)
            return nil
        case .response(let status, let body, let retryAfter):
            guard case .ok(let ack) = WireValidator.validateAcknowledgement(data: body) else {
                // [GUARD] An answer that is not a wire acknowledgement (proxy page,
                // 5xx) is treated as no answer: retry later, never trust it.
                noteFailure(afterSeconds: status >= 500 ? retryAfter : nil)
                return nil
            }
            if let control = ack.control, let expires = TimeText.parse(control.credentialExpiresAt) {
                credentialExpiresAt = expires
            }
            pull.observe(ack, answering: observation)
            return (ack, retryAfter)
        }
    }

    private func noteFailure(afterSeconds: Double?) {
        let delay = backoff.nextDelay(retryAfterSeconds: afterSeconds)
        outbox.deferHead(until: clock.now().addingTimeInterval(delay))
    }
}
