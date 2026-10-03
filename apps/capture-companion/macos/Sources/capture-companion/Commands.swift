import CaptureAdapters
import CaptureCore
import Foundation

// MARK: pair

// Reads the three values the Studio pairing panel shows (address, workspace
// slug, credential), checks their shape, and stores the credential in the
// Keychain. The credential is read without echo and never printed.
func pairCommand(paths: CompanionPaths) -> Int32 {
    print(Status.promptAddress, terminator: "")
    let address = readLine() ?? ""
    print(Status.promptSlug, terminator: "")
    let slug = readLine() ?? ""
    print(Status.promptCredential, terminator: "")
    let credential = readHidden()
    print(Status.blank)

    guard Endpoint(studioAddress: address, tenantSlug: slug) != nil else {
        print(Status.invalidAddress)
        return 2
    }
    guard Endpoint.isCredentialShape(credential) else {
        print(Status.invalidCredential)
        return 2
    }
    do {
        try KeychainCredentialStore().save(credential)
        try PairingRecord(
            studioAddress: address.trimmingCharacters(in: .whitespacesAndNewlines), tenantSlug: slug
        ).save(to: paths)
    } catch {
        print(Status.keychainFailed)
        return 1
    }
    print(Status.paired)
    return 0
}

private func readHidden() -> String {
    var original = termios()
    guard tcgetattr(STDIN_FILENO, &original) == 0 else { return readLine() ?? "" }
    var silent = original
    silent.c_lflag &= ~tcflag_t(ECHO)
    tcsetattr(STDIN_FILENO, TCSANOW, &silent)
    defer { tcsetattr(STDIN_FILENO, TCSANOW, &original) }
    return readLine() ?? ""
}

// MARK: stop / status

func stopCommand(paths: CompanionPaths) -> Int32 {
    guard let pid = RunPidFile(paths: paths).runningPid() else {
        print(Status.notRunning)
        return 1
    }
    // SIGTERM is handled by the running companion as a local stop.
    kill(pid, SIGTERM)
    print(Status.stopSent)
    return 0
}

func statusCommand(paths: CompanionPaths) -> Int32 {
    if PairingRecord.load(from: paths) == nil { print(Status.notPaired) } else { print(Status.pairedAlready) }
    if let pid = RunPidFile(paths: paths).runningPid() {
        print(Status.running)
        print(Status.pid(pid))
    } else {
        print(Status.notRunning)
    }
    if StopMarkerFile(paths: paths).isPresent() { print(Status.markerPresent) } else { print(Status.markerAbsent) }
    return 0
}

// MARK: run

// Lives on the main actor with the session. Capture callbacks arrive on OS
// queues, copy plain values, and hop here before touching Core.
@MainActor
final class RunBox {
    var session: CompanionSession?
    var rings: [CaptureSource: AudioRingBuffer] = [:]

    func audio(_ source: CaptureSource, _ frame: AudioFrame) {
        guard let session, session.machine.isCapturing, let ring = rings[source] else { return }
        if let overflow = ring.push(frame) {
            session.reportAudioOverflow(source: source, droppedMs: overflow.droppedMs)
        }
    }

    func screenshot(_ jpeg: Data, _ label: String) {
        _ = session?.submitScreenshot(payload: jpeg, mediaType: .jpeg, windowLabel: label)
    }

    func lost(_ source: CaptureSource, _ reason: DisconnectReason) {
        session?.sourceLost(source, reason: reason)
    }

    // [SAFETY] The one local stop path: signal, keypress and `stop` all land here.
    func stopNow() { session?.localStop() }
}

private struct RunOptions {
    var selection: Set<CaptureSource> = []
    var locale = Locale.current.identifier
    var windowTitle: String?

    init?(_ arguments: [String]) {
        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--microphone": selection.insert(.microphone)
            case "--app-audio": selection.insert(.applicationAudio)
            case "--screen": selection.insert(.screen)
            case "--locale":
                index += 1
                guard index < arguments.count else { return nil }
                locale = arguments[index]
            case "--window-title":
                index += 1
                guard index < arguments.count else { return nil }
                windowTitle = arguments[index]
            default: return nil
            }
            index += 1
        }
    }
}

@MainActor
func runCommand(arguments: [String], paths: CompanionPaths) async -> Int32 {
    guard let options = RunOptions(arguments), !options.selection.isEmpty else {
        print(Status.noSources)
        return 64
    }
    let credentials = KeychainCredentialStore()
    guard let record = PairingRecord.load(from: paths),
        let endpoint = Endpoint(studioAddress: record.studioAddress, tenantSlug: record.tenantSlug),
        (try? credentials.load()) != nil
    else {
        print(Status.notPaired)
        return 2
    }
    let pidFile = RunPidFile(paths: paths)
    guard pidFile.runningPid() == nil else {
        print(Status.alreadyRunning)
        return 1
    }
    let marker = StopMarkerFile(paths: paths)
    // A new run starts fresh; the previous run's stop marker has done its job.
    marker.clear()
    try? pidFile.write()
    defer { pidFile.remove() }

    let box = RunBox()
    let events = CaptureEvents(
        onAudio: { source, frame in Task { @MainActor in box.audio(source, frame) } },
        onScreenshot: { jpeg, label in Task { @MainActor in box.screenshot(jpeg, label) } },
        onLost: { source, reason in Task { @MainActor in box.lost(source, reason) } })
    let sources = SystemCaptureSources(
        selection: options.selection, windowTitleContains: options.windowTitle, events: events)
    for source in options.selection where source != .screen {
        box.rings[source] = AudioRingBuffer(maxSeconds: 30)
    }
    let runId = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)).lowercased()
    let session = CompanionSession(
        selection: options.selection, runId: runId, endpoint: endpoint, credentials: credentials,
        transport: URLSessionTransport(), clock: SystemClock(), sources: sources, marker: marker,
        buffers: Array(box.rings.values), backoff: Backoff(random: { Double.random(in: 0..<1) }))
    box.session = session
    installLocalStopTriggers(box)
    print(Status.selected(options.selection.sorted { $0.rawValue < $1.rawValue }))
    print(Status.stopHint)

    // [GUARD] Check on-device speech first when any audio source is selected.
    // A failure is shown and reported; nothing starts and nothing falls back.
    let needsSpeech = options.selection.contains(.microphone) || options.selection.contains(.applicationAudio)
    var capability: CapabilityOutcome?
    if needsSpeech {
        let outcome = await CapabilityCheck.evaluate(
            locale: options.locale, speech: OnDeviceSpeechProbe(), permissions: SystemPermissionProbe(),
            sourceId: session.factory.companionId, sentAt: TimeText.iso(Date()))
        capability = outcome
        await session.sendCapabilityReport(outcome.report)
        if let failure = outcome.failure {
            print(Status.speechUnavailable)
            print(Status.speechReason(failure))
        }
    }
    session.start(capability: capability)

    var transcribers: [CaptureSource: OnDeviceTranscriber] = [:]
    if capability?.failure == nil {
        for source in options.selection where source != .screen {
            let transcriptSource: TranscriptSource = source == .microphone ? .microphone : .applicationAudio
            let transcriber = OnDeviceTranscriber(
                locale: options.locale,
                onFinal: { text, start, end in
                    Task { @MainActor in
                        _ = box.session?.submitTranscript(source: transcriptSource, text: text, startMs: start, endMs: end)
                    }
                },
                onFailure: { Task { @MainActor in box.lost(source, .error) } })
            if let transcriber {
                transcribers[source] = transcriber
            } else {
                session.sourceLost(source, reason: .error)
            }
        }
    }
    return await runLoop(session: session, box: box, transcribers: transcribers)
}

@MainActor
private func runLoop(
    session: CompanionSession, box: RunBox, transcribers: [CaptureSource: OnDeviceTranscriber]
) async -> Int32 {
    let permissions = SystemPermissionProbe()
    var lastPrinted: CompanionState?
    var transcribing = false
    var counter = 0
    while true {
        let state = session.machine.state
        if state != lastPrinted {
            print(Status.state(state))
            lastPrinted = state
        }
        // Start and stop recognition with capture; stopped recognisers discard
        // any unfinished text rather than flush it.
        if session.machine.isCapturing != transcribing {
            transcribing = session.machine.isCapturing
            for transcriber in transcribers.values {
                if transcribing { transcriber.start() } else { transcriber.stop() }
            }
        }
        for (source, ring) in box.rings { transcribers[source]?.feed(ring.drain()) }

        if counter % 4 == 0 {
            await watchPermissions(session: session, probe: permissions)
            await session.tick()
            print(Status.queued(session.outbox.count))
        }
        if session.machine.isTerminal {
            // The final tick above sent any best-effort stop notices once.
            for transcriber in transcribers.values { transcriber.stop() }
            print(Status.state(session.machine.state))
            return 0
        }
        counter += 1
        try? await Task.sleep(for: .milliseconds(250))
    }
}

// Permission revocation shows up as authorisation changing under a running source.
@MainActor
private func watchPermissions(session: CompanionSession, probe: SystemPermissionProbe) async {
    if session.machine.statuses[.microphone] == .running, await probe.microphone() != .granted {
        session.sourceLost(.microphone, reason: .permissionRevoked)
    }
    for source in [CaptureSource.screen, .applicationAudio] where session.machine.statuses[source] == .running {
        if await probe.screen() != .granted { session.sourceLost(source, reason: .permissionRevoked) }
    }
}

// SIGINT, SIGTERM (what `stop` sends) and typing `s` then Enter all stop locally.
@MainActor
private func installLocalStopTriggers(_ box: RunBox) {
    for signalNumber in [SIGINT, SIGTERM] {
        signal(signalNumber, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
        source.setEventHandler { MainActor.assumeIsolated { box.stopNow() } }
        source.resume()
        retainedSignalSources.append(source)
    }
    FileHandle.standardInput.readabilityHandler = { handle in
        let line = String(decoding: handle.availableData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if line == "s" { DispatchQueue.main.async { MainActor.assumeIsolated { box.stopNow() } } }
    }
}

@MainActor private var retainedSignalSources: [DispatchSourceSignal] = []
