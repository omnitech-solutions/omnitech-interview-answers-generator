import AppKit
import CaptureAdapters
import CaptureCore
import CoreGraphics
import Foundation
import StudioShellCore

// [SAFETY] Core's SourceControl for the shell: only the sources Studio named
// are ever built. The microphone and application audio are the companion's own
// adapters. The screen source holds NO stream: the shell captures one still
// image per Studio request and never samples the screen on its own, so "screen
// running" only means Screen Recording is allowed and Studio may ask.
// [SAFETY] INVARIANT (@unchecked Sendable): every stored property is a `let`
// holding a Sendable value (`CaptureEvents` is a Sendable struct of @Sendable
// closures) or an object that is itself an audited @unchecked Sendable adapter
// (`MicrophoneCapture`, `ScreenKitSource`); the only `var`, `generation`, is read
// and written inside `lock.withLock`. This type adds no hazard of its own, but it
// inherits the unguarded start/stop overlap noted on those adapters (the `Task`s
// started here are not ordered with `stop`).
// REMOVAL PLAN: drop it when the two adapters become Sendable or actors, and keep
// `generation` in an `OSAllocatedUnfairLock<Int>`.
final class EngineSources: SourceControl, @unchecked Sendable {
    private let microphone: MicrophoneCapture?
    private let applicationAudio: ScreenKitSource?
    private let screenSelected: Bool
    private let events: CaptureEvents
    private let lock = NSLock()
    private var generation = 0

    init(selection: Set<CaptureSource>, events: CaptureEvents) {
        self.events = events
        microphone =
            selection.contains(.microphone)
            ? MicrophoneCapture(
                onFrame: { events.onAudio(.microphone, $0) }, onLost: { events.onLost(.microphone, $0) })
            : nil
        applicationAudio =
            selection.contains(.applicationAudio)
            ? ScreenKitSource(
                kind: .applicationAudio, onAudio: { events.onAudio(.applicationAudio, $0) },
                onScreenshot: { _, _ in }, onLost: { events.onLost(.applicationAudio, $0) })
            : nil
        screenSelected = selection.contains(.screen)
    }

    func start(_ source: CaptureSource) {
        switch source {
        case .microphone:
            guard let microphone else { return }
            Task { _ = await microphone.start() }
        case .applicationAudio:
            guard let applicationAudio else { return }
            Task { _ = await applicationAudio.start() }
        case .screen:
            guard screenSelected else { return }
            lock.withLock { generation += 1 }
            // The one place macOS may prompt for Screen Recording. A refusal is a visible loss, never a retry loop.
            if !CGPreflightScreenCaptureAccess(), !CGRequestScreenCaptureAccess() {
                events.onLost(.screen, .permissionRevoked)
            }
        }
    }

    func stop(_ source: CaptureSource) {
        switch source {
        case .microphone: microphone?.stop()
        case .applicationAudio:
            guard let applicationAudio else { return }
            Task { await applicationAudio.stop() }
        case .screen: break
        }
    }

    // The token Studio binds a region to: the main display and this start's generation.
    func screenSelection() -> String? {
        guard screenSelected else { return nil }
        return "\(CGMainDisplayID()).\(lock.withLock { generation })"
    }
}

// The frontmost application when a request is TAKEN, never the shell itself
// (the same rule as the page-driven capture, StudioShellCore.FocusSampling).
@MainActor
public final class FocusTracker {
    private let ownPid = ProcessInfo.processInfo.processIdentifier
    private var lastOther: Int32?
    private var observer: NSObjectProtocol?

    public init() {
        lastOther = Self.otherFrontmost(ownPid)
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated {
                guard let self, let pid, pid != self.ownPid else { return }
                self.lastOther = pid
            }
        }
    }

    private static func otherFrontmost(_ own: Int32) -> Int32? {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier, pid != own else { return nil }
        return pid
    }

    public func sample() -> FocusSample {
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return FocusSample(
            frontmostPid: FocusSampling.sample(frontmost: frontmost, ownPid: ownPid, lastOther: lastOther))
    }
}

private final class MemoryStopMarker: StopMarkerStore {
    func persistStoppedLocally(at time: Date) throws {}
}

// [DOMAIN] The production EngineRun: the capture companion's own session
// (CompanionSession: heartbeat, acknowledgement, control, capture requests and
// failures, negotiation headers) over its own adapters, driven by the engine's
// passes instead of the CLI's loop. Mirrors runCommand/runLoop in
// apps/capture-companion/macos/Sources/capture-companion/Commands.swift.
// [SAFETY] Speech is recognised on this Mac only (OnDeviceTranscriber); nothing
// is written to disk (the stop marker is in memory); text and pixels are never logged.
@MainActor
public final class SystemCompanionRun: EngineRun {
    private let plan: RunPlan
    private let locale: String
    private let focus: FocusTracker
    private let permissions = SystemPermissionProbe()
    private let session: CompanionSession
    private let sources: EngineSources
    private var rings: [CaptureSource: AudioRingBuffer] = [:]
    private var transcribers: [CaptureSource: OnDeviceTranscriber] = [:]
    private var capability: CapabilityOutcome?
    private var transcribing = false
    private var capturing = false
    private var counter = 0
    private var started = false
    public private(set) var lastHeardAt: Date?
    // What the last pass heard per source: the level drives the footer's sound
    // wave; the fed milliseconds and segment count are logged every ~15 s so the
    // event log shows whether audio arrives and whether it turns into text.
    private var levels: [CaptureSource: Int] = [:]
    private var fedMs: [CaptureSource: Int] = [:]
    private var segments = 0

    public var audioLevel: Int { session.machine.isCapturing ? (levels[.microphone] ?? 0) : 0 }

    public init(
        plan: RunPlan, endpoint: Endpoint, credentials: CredentialStore, focus: FocusTracker,
        locale: String = Locale.current.identifier
    ) {
        self.plan = plan
        self.locale = locale
        self.focus = focus
        // Audio and screen callbacks arrive on OS queues; they copy plain values and hop to the main actor.
        let box = EventBox()
        let events = CaptureEvents(
            onAudio: { source, frame in Task { @MainActor in box.run?.audio(source, frame) } },
            onScreenshot: { _, _ in },
            onLost: { source, reason in Task { @MainActor in box.run?.lost(source, reason) } })
        let sources = EngineSources(selection: plan.sources, events: events)
        self.sources = sources
        for source in plan.sources where source != .screen { rings[source] = AudioRingBuffer(maxSeconds: 30) }
        let runId = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)).lowercased()
        session = CompanionSession(
            selection: plan.sources, runId: runId, endpoint: endpoint, credentials: credentials,
            transport: URLSessionTransport(), clock: SystemClock(), sources: sources, marker: MemoryStopMarker(),
            buffers: Array(rings.values), backoff: Backoff(random: { Double.random(in: 0..<1) }),
            screenSelection: { sources.screenSelection() }, focusSampler: { [focus] in focus.sample() })
        box.run = self
    }

    // [SAFETY] The only stored property is isolated to the main actor, so the box is
    // Sendable by isolation, not by assertion: the OS-queue callbacks capture the box
    // and read `run` only inside `Task { @MainActor in ... }`.
    @MainActor private final class EventBox {
        var run: SystemCompanionRun?
    }

    fileprivate func audio(_ source: CaptureSource, _ frame: AudioFrame) {
        guard session.machine.isCapturing, let ring = rings[source] else { return }
        if let overflow = ring.push(frame) {
            session.reportAudioOverflow(source: source, droppedMs: overflow.droppedMs)
        }
    }

    fileprivate func lost(_ source: CaptureSource, _ reason: DisconnectReason) {
        session.sourceLost(source, reason: reason)
    }

    // MARK: EngineRun

    public var state: CompanionState { session.machine.state }
    public var sourceStatuses: [CaptureSource: SourceStatus] { session.machine.statuses }
    public var speechFailure: SpeechFailure? { session.machine.speechFailure }

    public func start() async {
        // [GUARD] On-device speech first when any audio source is selected: a
        // failure is a visible state, nothing starts and nothing falls back.
        let needsSpeech = plan.sources.contains(.microphone) || plan.sources.contains(.applicationAudio)
        if needsSpeech {
            let outcome = await CapabilityCheck.evaluate(
                locale: locale, speech: OnDeviceSpeechProbe(), permissions: permissions,
                sourceId: session.factory.companionId, sentAt: TimeText.iso(Date()))
            capability = outcome
            await session.sendCapabilityReport(outcome.report)
        }
        session.start(capability: capability)
        started = true
        guard capability?.failure == nil else { return }
        for source in plan.sources where source != .screen {
            let transcriptSource: TranscriptSource = source == .microphone ? .microphone : .applicationAudio
            let transcriber = OnDeviceTranscriber(
                locale: locale,
                onFinal: { [weak self] text, start, end in
                    Task { @MainActor in self?.heard(transcriptSource, text, start, end) }
                },
                onFailure: { [weak self] in Task { @MainActor in self?.lost(source, .error) } })
            if let transcriber {
                transcribers[source] = transcriber
            } else {
                session.sourceLost(source, reason: .error)
            }
        }
    }

    private func heard(_ source: TranscriptSource, _ text: String, _ start: Int, _ end: Int) {
        let queued = session.submitTranscript(source: source, text: text, startMs: start, endMs: end) != nil
        if queued { lastHeardAt = Date() }
        segments += 1
        // Queued for Studio, or dropped (not capturing, empty, oversize): the
        // size and the verdict, never the words.
        CompanionEvents.record(
            .system, "transcript.produced",
            ["source": source.rawValue, "chars": "\(text.count)", "queued": queued ? "true" : "false"])
    }

    // Roughly how loud the microphone was over the frames of one pass, 0-100
    // in steps of 20 (about -50 dBFS to -10 dBFS), so a change is a real one.
    static func level(_ frames: [AudioFrame]) -> Int {
        var sum = 0.0
        var count = 0
        for frame in frames {
            for sample in frame.samples { sum += Double(sample * sample) }
            count += frame.samples.count
        }
        guard count > 0 else { return 0 }
        let decibels = 20 * log10(max(sum / Double(count), 1e-12).squareRoot())
        let scaled = (decibels + 50) / 40 * 100
        return Int((min(max(scaled, 0), 100) / 20).rounded()) * 20
    }

    public func step() async {
        guard started else { return }
        // Start and stop recognition with capture; stopped recognisers discard unfinished text.
        if session.machine.isCapturing != transcribing {
            transcribing = session.machine.isCapturing
            for transcriber in transcribers.values {
                if transcribing { transcriber.start() } else { transcriber.stop() }
            }
        }
        for (source, ring) in rings {
            let frames = ring.drain()
            levels[source] = Self.level(frames)
            fedMs[source, default: 0] += frames.reduce(0) { $0 + $1.durationMs }
            transcribers[source]?.feed(frames)
        }
        if counter % 60 == 59 {
            CompanionEvents.record(
                .system, "audio.fed",
                [
                    "ms": fedMs.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: ","),
                    "segments": "\(segments)", "transcribing": transcribing ? "true" : "false",
                ])
            fedMs = [:]
            segments = 0
        }
        serveCaptureRequest()
        if counter % 4 == 0 {
            await watchPermissions()
            await session.tick()
        }
        if session.machine.isTerminal {
            if counter % 4 != 0 { await session.tick() }
            for transcriber in transcribers.values { transcriber.stop() }
        }
        counter += 1
    }

    // One capture at a time; a request that arrives meanwhile waits for the next pass.
    private func serveCaptureRequest() {
        guard !capturing else { return }
        guard case .honour(let request, let sample) = session.takeCaptureRequest() else { return }
        capturing = true
        Task { @MainActor in
            let outcome = await ScreenKitOneShot.capture(request, focus: sample)
            _ = session.completeCapture(request, outcome: outcome)
            capturing = false
        }
    }

    private func watchPermissions() async {
        if session.machine.statuses[.microphone] == .running, await permissions.microphone() != .granted {
            session.sourceLost(.microphone, reason: .permissionRevoked)
        }
        for source in [CaptureSource.screen, .applicationAudio] where session.machine.statuses[source] == .running {
            if await permissions.screen() != .granted { session.sourceLost(source, reason: .permissionRevoked) }
        }
    }

    public func canRecover() async -> Bool {
        if session.machine.speechFailure != nil {
            let outcome = await CapabilityCheck.evaluate(
                locale: locale, speech: OnDeviceSpeechProbe(), permissions: permissions,
                sourceId: session.factory.companionId, sentAt: TimeText.iso(Date()))
            return outcome.failure == nil
        }
        for (source, status) in session.machine.statuses where status == .lost || status == .revoked {
            switch source {
            case .microphone: if await permissions.microphone() != .granted { return false }
            case .applicationAudio, .screen: if await permissions.screen() != .granted { return false }
            }
        }
        return true
    }

    public func stopLocally() { session.localStop() }

    public func discard() {
        for transcriber in transcribers.values { transcriber.stop() }
        for source in plan.sources { sources.stop(source) }
        for ring in rings.values { _ = ring.drain() }
    }
}
