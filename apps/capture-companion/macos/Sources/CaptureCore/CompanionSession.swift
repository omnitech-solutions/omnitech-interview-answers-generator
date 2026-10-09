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
    private let captureInbox = CaptureRequestInbox()
    // The driver's token for the selected screen source (display identity plus a generation that
    // changes whenever the selection restarts), and the platform's focus sampler.
    private let screenSelection: @MainActor () -> String?
    private let focusSampler: @MainActor () -> FocusSample
    // The failure to report for the one request in flight, until Studio has answered it.
    private var pendingFailure: CaptureFailure?
    public let heartbeatIntervalSeconds: Double
    // While the screen source runs, Studio may hand over a capture-now request
    // on any acknowledgement, so the heartbeat pulls this often instead.
    public static let screenPullSeconds = 2.0

    public init(
        selection: Set<CaptureSource>, runId: String, endpoint: Endpoint, credentials: CredentialStore,
        transport: Transport, clock: WallClock, sources: SourceControl, marker: StopMarkerStore,
        buffers: [AudioRingBuffer], backoff: Backoff, outboxCapacity: Int = 500,
        heartbeatIntervalSeconds: Double = 5, screenSelection: @escaping @MainActor () -> String? = { nil },
        focusSampler: @escaping @MainActor () -> FocusSample = { .none }
    ) {
        self.screenSelection = screenSelection
        self.focusSampler = focusSampler
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
        self.heartbeatIntervalSeconds = max(
            heartbeatIntervalSeconds, Double(ActiveSessionLimits.minHeartbeatIntervalMs) / 1000)
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

    public func submitScreenshot(
        payload: Data, mediaType: ScreenMediaType, windowLabel: String, requestId: String? = nil
    ) -> Observation? {
        guard machine.isCapturing, machine.statuses[.screen] == .running,
            payload.count >= 1, payload.count <= ActiveSessionLimits.maxScreenshotBytes
        else { return nil }
        let reference = "shot-\(factory.runId)-\(outbox.count)-\(Int(clock.now().timeIntervalSince1970 * 1000))"
        let observation = factory.make(
            .screen,
            .screenSnapshot(
                ScreenContent(
                    payloadRef: reference, mediaType: mediaType, byteLength: payload.count,
                    windowLabel: String(windowLabel.prefix(ActiveSessionLimits.maxWindowLabelChars)),
                    requestId: requestId)))
        outbox.enqueue(observation, payload: payload, now: clock.now())
        return observation
    }

    // MARK: capture now

    // True only while the screen source the person selected at start is running
    // (not paused, lost, revoked, refused, stopped or never selected).
    private var screenRunning: Bool { machine.isCapturing && machine.statuses[.screen] == .running }

    // [SAFETY] The request handed over on an acknowledgement, if any, taken ONCE.
    // Honoured only while the screen source is running; anything else is dropped
    // visibly so the person can see why nothing was captured.
    public func takeCaptureRequest() -> CaptureTake {
        guard let (request, focus) = captureInbox.takeWithFocus() else { return .nothing }
        // [SAFETY] Every way a request cannot be honoured is reported to Studio as one typed
        // failure for that id (except a missed deadline, which Studio already expired), so the
        // owner hears at once instead of at expiry. Nothing is ever captured wider instead.
        if let deadline = TimeText.parse(request.expiresAt), clock.now() >= deadline { return .expired }
        guard screenRunning else {
            reportCaptureFailure(request, .sourceGone)
            return .ignored
        }
        if let selection = request.selection, selection != screenSelection() {
            reportCaptureFailure(request, .sourceChanged)
            return .sourceChanged
        }
        return .honour(request, focus)
    }

    // Queues the failure; `tick` sends it, and resends it until Studio has answered.
    public func reportCaptureFailure(_ request: CaptureRequest, _ code: CaptureFailureCode) {
        guard !machine.isTerminal else { return }
        pendingFailure = CaptureFailure(
            sourceId: factory.companionId, sentAt: TimeText.iso(clock.now()), requestId: request.requestId, code: code)
    }

    private func sendPendingFailure() async {
        guard let failure = pendingFailure else { return }
        guard let result = await send(.captureFailure(failure), payload: nil, answering: nil) else { return }
        if case .refused(.rateLimited, _, _) = result.ack { return }
        pendingFailure = nil
    }

    // Sends what one capture-now request produced, tagged with its id. The
    // world may have changed while capturing: pause, end or a lost screen
    // means nothing captured is sent.
    @discardableResult
    public func completeCapture(_ request: CaptureRequest, outcome: CaptureOutcome) -> CaptureCompletion {
        guard screenRunning else { return .dropped }
        switch outcome {
        case .lost(let loss):
            reportCaptureFailure(request, loss.failureCode)
            return .lost(loss)
        case .image(let jpeg, let windowLabel):
            let sent = submitScreenshot(
                payload: jpeg, mediaType: .jpeg, windowLabel: windowLabel, requestId: request.requestId)
            return sent == nil ? .dropped : .submitted
        }
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

    // MARK: voice activity

    // [SAFETY] Per-source state, never shared: the microphone's noise floor
    // says nothing about the call's. Only loudness values are held, never audio.
    private var voiceDetectors: [CaptureSource: VoiceActivityDetector] = [:]
    private var voiceReporters: [CaptureSource: VoiceActivityReporter] = [:]
    private var voiceTotals: [CaptureSource: VoiceActivityTotals] = [:]
    // Studio said it does not take voice activity (switched off, a device-only
    // session, or a Studio that does not know the message): nothing more is
    // sent for the rest of this run. Detection carries on, for the totals.
    public private(set) var voiceActivityRefused = false

    // The audio one pass drained from a source's ring buffer, before it goes
    // to the recogniser: whether a voice is on it is decided here.
    public func hearAudio(source: CaptureSource, frames: [AudioFrame]) {
        guard source != .screen, !frames.isEmpty, machine.isCapturing, machine.statuses[source] == .running
        else { return }
        var detector = voiceDetectors[source] ?? VoiceActivityDetector()
        let was = detector.speaking
        detector.push(frames)
        voiceDetectors[source] = detector
        var totals = voiceTotals[source] ?? VoiceActivityTotals()
        if detector.speaking { totals.voicedMs += frames.reduce(0) { $0 + $1.durationMs } }
        if detector.speaking, !was { totals.starts += 1 }
        voiceTotals[source] = totals
    }

    // Whether a voice is on the source right now, as the detector reads it.
    public func voiceSpeaking(_ source: CaptureSource) -> Bool { voiceDetectors[source]?.speaking ?? false }

    // How much voice a source has carried since the run began: sizes for the
    // event log, so a person can check the detector against a call they heard.
    public func voiceTotals(_ source: CaptureSource) -> VoiceActivityTotals {
        voiceTotals[source] ?? VoiceActivityTotals()
    }

    // [DOMAIN] One pass: tells Studio what is due for each selected audio
    // source (a change at once, a keep-alive while a voice goes on). It is a
    // transient signal: never queued in the outbox, never resent, and a report
    // that does not get through is simply said again later if still true.
    // [SAFETY] Same credential, same ingest route and same headers as every
    // other message; the answer is read only for whether the report was taken.
    public func reportVoiceActivity() async {
        guard !voiceActivityRefused else { return }
        guard machine.isCapturing else {
            // Paused, lost or stopped: Studio lets what it was told lapse, and
            // a resume says where each source stands again.
            voiceDetectors = [:]
            voiceReporters = [:]
            return
        }
        for source in [CaptureSource.applicationAudio, .microphone] where machine.selection.contains(source) {
            if machine.statuses[source] != .running { voiceDetectors[source] = nil }
            let speaking = voiceDetectors[source]?.speaking ?? false
            let nowMs = Int(clock.now().timeIntervalSince1970 * 1000)
            var reporter = voiceReporters[source] ?? VoiceActivityReporter()
            guard let say = reporter.next(speaking: speaking, nowMs: nowMs) else { continue }
            switch await sendVoiceActivity(source, speaking: say) {
            case .taken: reporter.sent(speaking: say, nowMs: nowMs)
            case .later: reporter.failed(nowMs: nowMs)
            case .off(let code):
                voiceActivityRefused = true
                voiceReporters = [:]
                CompanionEvents.record(.server, "voice.activity_off", ["code": code.rawValue])
                return
            }
            voiceReporters[source] = reporter
        }
    }

    private enum VoiceDelivery {
        case taken, later
        case off(RefusalCode)
    }

    private func sendVoiceActivity(_ source: CaptureSource, speaking: Bool) async -> VoiceDelivery {
        let activity = VoiceActivity(
            sourceId: factory.companionId, sentAt: TimeText.iso(clock.now()),
            source: source == .microphone ? .microphone : .applicationAudio, speaking: speaking)
        guard let credential = try? credentials.load(),
            let request = endpoint.request(
                for: .voiceActivity(activity), credential: credential, screenSelection: screenSelection()),
            case .response(_, let body, _) = await transport.send(request),
            case .ok(let ack) = WireValidator.validateAcknowledgement(data: body)
        else { return .later }
        switch ack {
        case .accepted, .duplicate: return .taken
        case .refused(let code, _, _):
            switch code {
            // Off by the owner's switch or the session's locality; or a Studio
            // that does not know the message (it reads as an invalid observation).
            case .voiceActivityOff, .invalidObservation, .unsupportedVersion: return .off(code)
            default: return .later
            }
        }
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
        await sendPendingFailure()
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
            guard
                let result = await send(
                    .observation(queued.observation), payload: queued.payload, answering: queued.observation)
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
        } else if let last = lastHeartbeatAt, now.timeIntervalSince(last) < pullIntervalSeconds {
            return
        }
        lastHeartbeatAt = now
        // capturing:false asks Studio to pause the session, so it is sent only when the companion itself
        // has stopped. While Studio alone has paused it the companion is doing what it was told and says
        // so; otherwise the owner's resume would be undone by the very next heartbeat.
        let capturing = machine.isCapturing || machine.state == .paused
        // The companion's own state rides along (codes only), so Studio can say
        // WHY a heartbeat stopped capturing instead of just pausing.
        let diagnostics = HeartbeatDiagnostics(
            state: "\(machine.state)",
            sources: Dictionary(uniqueKeysWithValues: machine.statuses.map { ("\($0.key)", "\($0.value)") }),
            speechFailure: machine.speechFailure.map { "\($0)" })
        CompanionEvents.record(
            .heartbeat, "heartbeat",
            [
                "capturing": "\(capturing)", "state": diagnostics.state,
                "sources": diagnostics.sources.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(
                    separator: ","),
            ])
        let beat = Heartbeat(
            sourceId: factory.companionId, sentAt: TimeText.iso(now), capturing: capturing, diagnostics: diagnostics)
        _ = await send(.heartbeat(beat), payload: nil, answering: nil)
    }

    // Sends one message and reads control from the answer. Returns nil when
    // there was no usable answer (unreachable, malformed, server error).
    private func send(_ message: IngestMessage, payload: Data?, answering observation: Observation?) async -> (
        ack: Acknowledgement, retryAfter: Double?
    )? {
        guard let credential = try? credentials.load(),
            let request = endpoint.request(
                for: message, payload: payload, credential: credential, screenSelection: screenSelection())
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
            // [SAFETY] Only a fresh answer hands over a request: a duplicate
            // carries the ORIGINAL ack, and a finished run takes nothing.
            if !machine.isTerminal {
                switch ack {
                case .accepted(let accepted): captureInbox.offer(accepted.control.capture, sampleFocus: focusSampler)
                case .refused(_, let control, _): captureInbox.offer(control?.capture, sampleFocus: focusSampler)
                case .duplicate: break
                }
            }
            return (ack, retryAfter)
        }
    }

    private var pullIntervalSeconds: Double {
        guard machine.statuses[.screen] == .running else { return heartbeatIntervalSeconds }
        return max(
            min(heartbeatIntervalSeconds, Self.screenPullSeconds),
            Double(ActiveSessionLimits.minHeartbeatIntervalMs) / 1000)
    }

    private func noteFailure(afterSeconds: Double?) {
        let delay = backoff.nextDelay(retryAfterSeconds: afterSeconds)
        outbox.deferHead(until: clock.now().addingTimeInterval(delay))
    }
}
