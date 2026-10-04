import CaptureCore
import Foundation

// [DOMAIN] What one hands-free run needs: the session Studio named and the
// sources Studio's owner chose for it. The engine never adds a source.
public struct RunPlan: Equatable, Sendable {
    public let sessionId: String
    public let sources: Set<CaptureSource>

    public init(sessionId: String, sources: Set<CaptureSource>) {
        self.sessionId = sessionId
        self.sources = sources
    }
}

// One CompanionSession plus the platform sources around it. The production
// implementation is SystemCompanionRun; tests use a fake so the engine's state
// machine runs without a microphone, a screen or a network.
@MainActor
public protocol EngineRun: AnyObject {
    var state: CompanionState { get }
    var sourceStatuses: [CaptureSource: SourceStatus] { get }
    var speechFailure: SpeechFailure? { get }
    var lastHeardAt: Date? { get }
    func start() async
    // One pass (the engine calls it about four times a second).
    func step() async
    // True when a lost or revoked source, or a failed speech check, could succeed now.
    func canRecover() async -> Bool
    // The person's own stop: tells Studio capture has stopped.
    func stopLocally()
    // Stops sources quietly, without telling Studio (restart, hold, shutdown).
    func discard()
}

// [DOMAIN] Why Studio's engine.start was not carried out: a closed set.
public enum EngineStartRefusal: String, Equatable, Sendable {
    case invalidSession = "invalid-session"
    case noSources = "no-sources"
    case signedOut = "signed-out"
    case gone
    case storeFailed = "store-failed"
}

public enum EngineCommandResult: Equatable, Sendable {
    case ok
    case refused(EngineStartRefusal)
}

// [DOMAIN] The engine as ONE adapter-backed capability (ADR-0019). Studio (the
// page) decides when it runs and for which session and sources; the native side
// executes and reports typed state through `onChange`. The engine never starts,
// stops or pauses itself on its own initiative, and the session's pause and end
// stay authoritative in Studio: they arrive in Studio's acknowledgements and the
// engine only mirrors them. The credential never crosses this interface.
@MainActor
public protocol EngineHost: AnyObject {
    var snapshot: EngineSnapshot { get }
    var onChange: (EngineSnapshot) -> Void { get set }
    // Obtains the credential natively (as the signed-in owner), then listens.
    func start(sessionId: String, sources: Set<CaptureSource>) async -> EngineCommandResult
    // Stops listening quietly; Studio already knows why it asked.
    func stop() async
    // A hold asked for by Studio: sources stop, the pairing is kept. Studio's own pause still arrives by acknowledgement.
    func pause() async
    func resume() async
    // The window closing or the person disconnecting.
    func shutdown(revoke: Bool) async
}

// [STRATEGY] The embedded hands-free engine. After Studio's engine.start it:
//   pair     obtains a session-bound credential through the owner route and stores it in the Keychain
//   listen   runs the companion's own session (heartbeat, ack, control, capture requests)
//   keep up  renews before the two-hour cap, restarts on a refusal, recovers a lost source
// It owns no session state and never creates an assist request.
//
// [SAFETY] Nothing here logs or stores content. The credential is saved to the
// Keychain and loaded by the companion session for the Authorization header;
// no snapshot, event or description contains it.
@MainActor
public final class HandsFreeEngine: EngineHost {
    public struct Timing: Sendable {
        public var recoverSeconds = 15.0
        public var stepMilliseconds = 250
        // Tests drive `step()` themselves.
        public var runsOwnLoop = true
        // A credential refused this many times inside the window stops the retries.
        public var maxRefusals = 3
        public var refusalWindowSeconds = 600.0
        public init() {}
    }

    private final class Active {
        let plan: RunPlan
        let run: EngineRun
        var lastRecoverAt: Date
        init(plan: RunPlan, run: EngineRun, now: Date) {
            self.plan = plan
            self.run = run
            lastRecoverAt = now
        }
    }

    private enum Phase {
        case idle
        case pairing(RunPlan)
        case running(Active)
        case held(RunPlan)
    }

    private let routes: OwnerRoutes
    private let credentials: CredentialStore
    private let clock: WallClock
    private let makeRun: (RunPlan) -> EngineRun
    private let timing: Timing
    private var lifecycle: CredentialLifecycle
    private var pairBackoff: Backoff
    private var phase: Phase = .idle
    private var stage: PairingStage = .idle
    private var nextPairAt = Date.distantPast
    private var refusals: [Date] = []
    private var loop: Task<Void, Never>?
    // One operation at a time: a pass, or a command from Studio.
    private var busy = false

    public private(set) var snapshot = EngineSnapshot()
    public var onChange: (EngineSnapshot) -> Void = { _ in }

    public init(
        routes: OwnerRoutes, credentials: CredentialStore, clock: WallClock, timing: Timing = Timing(),
        random: @escaping () -> Double = { Double.random(in: 0..<1) },
        makeRun: @escaping (RunPlan) -> EngineRun
    ) {
        self.routes = routes
        self.credentials = credentials
        self.clock = clock
        self.timing = timing
        self.makeRun = makeRun
        lifecycle = CredentialLifecycle(random: random)
        pairBackoff = Backoff(baseSeconds: 2, capSeconds: 60, random: random)
    }

    // MARK: EngineHost

    public func start(sessionId: String, sources: Set<CaptureSource>) async -> EngineCommandResult {
        // [GUARD] What Studio sends is bounded: a session id and a non-empty set of known sources.
        guard UUID(uuidString: sessionId) != nil else { return .refused(.invalidSession) }
        guard !sources.isEmpty else { return .refused(.noSources) }
        let plan = RunPlan(sessionId: sessionId, sources: sources)
        await waitUntilFree()
        busy = true
        defer { busy = false }
        if case .running(let active) = phase, active.plan == plan { return .ok }
        tearDown()
        refusals = []
        ensureLoop()
        let result = await pair(plan)
        publish()
        return result
    }

    public func stop() async {
        await waitUntilFree()
        busy = true
        defer { busy = false }
        tearDown()
        try? credentials.delete()
        stage = .idle
        publish()
    }

    public func pause() async {
        await waitUntilFree()
        busy = true
        defer { busy = false }
        guard case .running(let active) = phase else { return }
        active.run.discard()
        phase = .held(active.plan)
        publish()
    }

    public func resume() async {
        await waitUntilFree()
        busy = true
        defer { busy = false }
        guard case .held(let plan) = phase else { return }
        await begin(plan)
        publish()
    }

    public func shutdown(revoke: Bool) async {
        loop?.cancel()
        loop = nil
        await waitUntilFree()
        busy = true
        defer { busy = false }
        var sessionId: String?
        switch phase {
        case .running(let active):
            sessionId = active.plan.sessionId
            if !revoke {
                active.run.stopLocally()
                await active.run.step()
            }
            active.run.discard()
        case .pairing(let plan), .held(let plan): sessionId = plan.sessionId
        case .idle: break
        }
        if revoke, let sessionId { _ = await routes.revokeCredential(sessionId: sessionId) }
        if revoke { try? credentials.delete() }
        lifecycle.forget()
        phase = .idle
        stage = .idle
        publish()
    }

    // The person's own "stop listening" on this Mac: Studio is told capture
    // stopped (it pauses the session), and nothing restarts until Studio starts it.
    public func stopLocally() async {
        await waitUntilFree()
        busy = true
        defer { busy = false }
        guard case .running(let active) = phase else { return }
        active.run.stopLocally()
        await active.run.step()
        active.run.discard()
        phase = .idle
        stage = .stopped
        publish()
    }

    // MARK: one pass

    public func step() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let now = clock.now()
        switch phase {
        case .idle, .held: break
        case .pairing(let plan): if now >= nextPairAt { _ = await pair(plan) }
        case .running(let active): await keepRunning(active, now: now)
        }
        publish()
    }

    private func waitUntilFree() async {
        while busy { try? await Task.sleep(for: .milliseconds(20)) }
    }

    private func ensureLoop() {
        guard timing.runsOwnLoop, loop == nil else { return }
        loop = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.step()
                try? await Task.sleep(for: .milliseconds(self.timing.stepMilliseconds))
            }
        }
    }

    private func tearDown() {
        if case .running(let active) = phase { active.run.discard() }
        lifecycle.forget()
        phase = .idle
    }

    // [SAFETY] The credential is issued through the owner route as the signed-in
    // person, stored in the Keychain, and used only by the companion session.
    private func pair(_ plan: RunPlan) async -> EngineCommandResult {
        phase = .pairing(plan)
        stage = .pairing
        publish()
        switch await routes.issueCredential(sessionId: plan.sessionId) {
        case .success(let issued):
            do { try credentials.save(issued.value) } catch {
                phase = .idle
                stage = .failed
                return .refused(.storeFailed)
            }
            pairBackoff.reset()
            lifecycle.issued(expiresAt: issued.expiresAt, at: clock.now())
            await begin(plan)
            return .ok
        case .failure(.signedOut):
            phase = .idle
            stage = .waitingForSignIn
            return .refused(.signedOut)
        case .failure(.gone):
            phase = .idle
            stage = .idle
            return .refused(.gone)
        case .failure(.unreachable):
            // Accepted and retrying: Studio sees the stage in the next event.
            stage = .unreachable
            nextPairAt = clock.now().addingTimeInterval(pairBackoff.nextDelay())
            return .ok
        }
    }

    private func begin(_ plan: RunPlan) async {
        let run = makeRun(plan)
        phase = .running(Active(plan: plan, run: run, now: clock.now()))
        stage = .paired
        await run.start()
    }

    private func keepRunning(_ active: Active, now: Date) async {
        await active.run.step()

        // Studio's own answers end or refuse a run; the engine reacts to the result.
        switch active.run.state {
        case .credentialRefused:
            await restartAfterRefusal(active, now: now)
            return
        case .ended:
            active.run.discard()
            try? credentials.delete()
            lifecycle.forget()
            phase = .idle
            stage = .ended
            return
        case .stoppedLocally:
            active.run.discard()
            phase = .idle
            stage = .stopped
            return
        default: break
        }

        // Renew well before the cap; the previous credential stops working at
        // once, so this happens between passes, never during a send.
        if lifecycle.shouldRenew(now: now) {
            stage = .renewing
            publish()
            switch await routes.issueCredential(sessionId: active.plan.sessionId) {
            case .success(let issued):
                if (try? credentials.save(issued.value)) != nil {
                    lifecycle.issued(expiresAt: issued.expiresAt, at: clock.now())
                    stage = .paired
                } else {
                    lifecycle.renewalFailed(now: now)
                    stage = .failed
                }
            case .failure(.unreachable):
                lifecycle.renewalFailed(now: now)
                stage = .paired
            case .failure(.signedOut):
                active.run.discard()
                lifecycle.forget()
                phase = .idle
                stage = .waitingForSignIn
                return
            case .failure(.gone):
                active.run.discard()
                lifecycle.forget()
                phase = .idle
                stage = .ended
                return
            }
        }

        if now.timeIntervalSince(active.lastRecoverAt) >= timing.recoverSeconds, hasProblem(active.run) {
            active.lastRecoverAt = now
            if await active.run.canRecover() {
                active.run.discard()
                await begin(active.plan)
            }
        }
    }

    private func restartAfterRefusal(_ active: Active, now: Date) async {
        active.run.discard()
        refusals = refusals.filter { now.timeIntervalSince($0) < timing.refusalWindowSeconds } + [now]
        lifecycle.forget()
        if refusals.count >= timing.maxRefusals {
            refusals = []
            phase = .idle
            stage = .failed
            return
        }
        _ = await pair(active.plan)
    }

    private func hasProblem(_ run: EngineRun) -> Bool {
        run.speechFailure != nil || run.sourceStatuses.values.contains { $0 == .lost || $0 == .revoked }
    }

    // MARK: snapshot

    private func publish() {
        let next = makeSnapshot()
        guard next != snapshot else { return }
        snapshot = next
        onChange(next)
    }

    private func makeSnapshot() -> EngineSnapshot {
        var sources: [EngineSourceKind: SourceHealth] = [:]
        var paused = false
        var age: Int?
        var failure: SpeechFailure?
        switch phase {
        case .running(let active):
            let run = active.run
            failure = run.speechFailure
            paused = run.state == .paused
            for source in active.plan.sources { sources[EngineSourceKind(source)] = health(source, run: run) }
            if let heard = run.lastHeardAt {
                // Five-second steps: listeners hear about a change only when this moves.
                age = Int(max(0, clock.now().timeIntervalSince(heard)) / 5) * 5
            }
        case .held: paused = true
        default: break
        }
        return EngineSnapshot(stage: stage, sources: sources, paused: paused, lastHeardAgeSeconds: age, speechFailure: failure)
    }

    private func health(_ source: CaptureSource, run: EngineRun) -> SourceHealth {
        if source != .screen, let failure = run.speechFailure {
            return failure == .notAuthorized ? .permissionDenied : .unavailable
        }
        switch run.sourceStatuses[source] {
        case .running: return .listening
        case .pending: return .starting
        case .lost: return .lost
        case .revoked: return .permissionDenied
        case .refused: return .unavailable
        case .pausedByStudio, .stopped, nil: return .off
        }
    }
}
