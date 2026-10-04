import CaptureCore
import Foundation
import StudioShellEngine

private let credentialA = "asc_" + String(repeating: "A", count: 43)
private let credentialB = "asc_" + String(repeating: "B", count: 43)
private let credentialC = "asc_" + String(repeating: "C", count: 43)
private let sessionId = "11111111-2222-4333-8444-555555555555"

private final class Store: CredentialStore {
    var value: String?
    var saves = 0
    func load() throws -> String? { value }
    func save(_ credential: String) throws {
        value = credential
        saves += 1
    }
    func delete() throws { value = nil }
}

private final class Clock: WallClock {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
    func now() -> Date { date }
    func advance(_ seconds: Double) { date = date.addingTimeInterval(seconds) }
}

@MainActor
private final class Routes: OwnerRoutes {
    var issues: [Result<IssuedCredential, OwnerRouteFailure>] = []
    var issueCalls = 0
    var revoked: [String] = []

    func issueCredential(sessionId: String) async -> Result<IssuedCredential, OwnerRouteFailure> {
        issueCalls += 1
        return issues.isEmpty ? .failure(.unreachable) : issues.removeFirst()
    }

    func revokeCredential(sessionId: String) async -> Bool {
        revoked.append(sessionId)
        return true
    }
}

@MainActor
private final class Run: EngineRun {
    var state: CompanionState = .listening
    var sourceStatuses: [CaptureSource: SourceStatus]
    var speechFailure: SpeechFailure?
    var lastHeardAt: Date?
    var recoverable = false
    var started = false, discarded = false, localStopped = false
    var steps = 0
    init(_ sources: Set<CaptureSource>) {
        sourceStatuses = Dictionary(uniqueKeysWithValues: sources.map { ($0, .running) })
    }
    func start() async { started = true }
    func step() async { steps += 1 }
    func canRecover() async -> Bool { recoverable }
    func stopLocally() { localStopped = true }
    func discard() { discarded = true }
}

@MainActor
private final class Bench {
    let routes = Routes()
    let store = Store()
    let clock = Clock()
    var runs: [Run] = []
    var engine: HandsFreeEngine!
    var events: [EngineSnapshot] = []

    init() {
        var timing = HandsFreeEngine.Timing()
        timing.runsOwnLoop = false
        engine = HandsFreeEngine(routes: routes, credentials: store, clock: clock, timing: timing, random: { 0.5 }) {
            [unowned self] plan in
            let run = Run(plan.sources)
            self.runs.append(run)
            return run
        }
        engine.onChange = { [unowned self] in self.events.append($0) }
    }

    var run: Run { runs[runs.count - 1] }

    func issued(_ value: String, lifetime: Double = 7200) -> Result<IssuedCredential, OwnerRouteFailure> {
        .success(IssuedCredential(value: value, expiresAt: clock.now().addingTimeInterval(lifetime)))
    }

    func started(_ sources: Set<CaptureSource> = [.microphone, .screen]) async {
        routes.issues = [issued(credentialA)]
        _ = await engine.start(sessionId: sessionId, sources: sources)
    }
}

@MainActor
func engineTests(_ t: Harness) async {
    await t.test("engine.start refuses a malformed session or no sources and does nothing") {
        let b = Bench()
        t.expectEqual(await b.engine.start(sessionId: "nope", sources: [.microphone]), .refused(.invalidSession))
        t.expectEqual(await b.engine.start(sessionId: sessionId, sources: []), .refused(.noSources))
        t.expectEqual(b.routes.issueCalls, 0, "no credential asked for")
        t.expectEqual(b.engine.snapshot.stage, .idle)
    }

    await t.test("start pairs through the owner route, stores the credential and listens to exactly the named sources") {
        let b = Bench()
        await b.started([.microphone, .screen])
        t.expectEqual(b.store.value, credentialA)
        t.expect(b.run.started, "run started")
        t.expectEqual(b.engine.snapshot.stage, .paired)
        t.expectEqual(b.engine.snapshot.health(.microphone), .listening)
        t.expectEqual(b.engine.snapshot.health(.screen), .listening)
        t.expectEqual(b.engine.snapshot.health(.systemAudio), .off, "unnamed source stays off")
        t.expect(b.engine.snapshot.isListening)
    }

    await t.test("the credential never appears in the state a page receives") {
        let b = Bench()
        await b.started()
        let data = try JSONSerialization.data(withJSONObject: b.engine.snapshot.bridgeValue)
        let text = String(decoding: data, as: UTF8.self)
        t.expect(!text.contains("asc_") && !text.contains(credentialA), "no credential in the bridge value")
        t.expect(!"\(IssuedCredential(value: credentialA, expiresAt: Date()))".contains("asc_"), "description is redacted")
    }

    await t.test("a repeated start for the same plan is idempotent; a new session replaces the run") {
        let b = Bench()
        await b.started()
        t.expectEqual(await b.engine.start(sessionId: sessionId, sources: [.microphone, .screen]), .ok)
        t.expectEqual(b.runs.count, 1, "no second run")
        b.routes.issues = [b.issued(credentialB)]
        _ = await b.engine.start(sessionId: "99999999-2222-4333-8444-555555555555", sources: [.screen])
        t.expectEqual(b.runs.count, 2)
        t.expect(b.runs[0].discarded, "old run stopped quietly")
        t.expect(!b.runs[0].localStopped, "Studio is not told it stopped")
    }

    await t.test("signed out: start is refused with a plain hint and nothing listens") {
        let b = Bench()
        b.routes.issues = [.failure(.signedOut)]
        t.expectEqual(await b.engine.start(sessionId: sessionId, sources: [.microphone]), .refused(.signedOut))
        t.expectEqual(b.engine.snapshot.stage, .waitingForSignIn)
        t.expectEqual(b.engine.snapshot.hint, "Sign in to Studio to start listening.")
        t.expect(b.runs.isEmpty && b.store.value == nil)
    }

    await t.test("Studio unreachable at start: accepted, retried on a growing backoff, then pairs") {
        let b = Bench()
        b.routes.issues = [.failure(.unreachable), .failure(.unreachable), b.issued(credentialA)]
        t.expectEqual(await b.engine.start(sessionId: sessionId, sources: [.microphone]), .ok)
        t.expectEqual(b.engine.snapshot.stage, .unreachable)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 1, "waits for the backoff")
        b.clock.advance(1.5)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 2)
        t.expectEqual(b.engine.snapshot.stage, .unreachable)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 2, "second delay is longer")
        b.clock.advance(3)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 3)
        t.expectEqual(b.engine.snapshot.stage, .paired)
        t.expectEqual(b.store.value, credentialA)
    }

    await t.test("the credential is renewed before the two-hour cap, not before") {
        let b = Bench()
        await b.started()
        b.clock.advance(3600)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 1, "an hour in: nothing to renew")
        b.routes.issues = [b.issued(credentialB)]
        b.clock.advance(3600 - CredentialLifecycle.renewLeadSeconds + 1)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 2)
        t.expectEqual(b.store.value, credentialB, "the new credential replaces the old")
        t.expectEqual(b.runs.count, 1, "the run carries on")
        t.expectEqual(b.engine.snapshot.stage, .paired)
    }

    await t.test("a failed renewal retries with backoff and never restarts the run") {
        let b = Bench()
        await b.started()
        b.clock.advance(7200 - 600)
        b.routes.issues = [.failure(.unreachable), b.issued(credentialC)]
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 2)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 2, "waits")
        b.clock.advance(5)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 3)
        t.expectEqual(b.store.value, credentialC)
        t.expectEqual(b.runs.count, 1)
    }

    await t.test("a renewal storm is refused: a credential that expires with the session renews at most once a minute") {
        var lifecycle = CredentialLifecycle(random: { 0.5 })
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        lifecycle.issued(expiresAt: now.addingTimeInterval(300), at: now)
        t.expect(!lifecycle.shouldRenew(now: now.addingTimeInterval(10)))
        t.expect(lifecycle.shouldRenew(now: now.addingTimeInterval(61)))
    }

    await t.test("a refusal renews and restarts; the third refusal stops and says so") {
        let b = Bench()
        await b.started()
        b.run.state = .credentialRefused
        b.routes.issues = [b.issued(credentialB)]
        await b.engine.step()
        t.expectEqual(b.runs.count, 2, "restarted with a fresh credential")
        t.expectEqual(b.store.value, credentialB)
        t.expect(b.runs[0].discarded)
        b.run.state = .credentialRefused
        b.routes.issues = [b.issued(credentialC)]
        await b.engine.step()
        t.expectEqual(b.runs.count, 3)
        b.run.state = .credentialRefused
        b.routes.issues = [b.issued(credentialA)]
        await b.engine.step()
        t.expectEqual(b.runs.count, 3, "no fourth run")
        t.expectEqual(b.engine.snapshot.stage, .failed)
    }

    await t.test("Studio ending the session stops the engine and it does not restart itself") {
        let b = Bench()
        await b.started()
        b.run.state = .ended
        await b.engine.step()
        t.expectEqual(b.engine.snapshot.stage, .ended)
        t.expect(b.store.value == nil, "credential removed")
        await b.engine.step()
        t.expectEqual(b.runs.count, 1)
        t.expectEqual(b.routes.issueCalls, 1)
    }

    await t.test("Studio's pause is mirrored, not decided: sources go off and the state says paused") {
        let b = Bench()
        await b.started()
        b.run.state = .paused
        b.run.sourceStatuses = [.microphone: .pausedByStudio, .screen: .pausedByStudio]
        await b.engine.step()
        t.expect(b.engine.snapshot.paused)
        t.expectEqual(b.engine.snapshot.health(.microphone), .off)
        t.expect(!b.engine.snapshot.isListening)
    }

    await t.test("permission loss is never listening: it names the one setting to grant, and recovers by itself") {
        let b = Bench()
        await b.started([.microphone, .applicationAudio])
        b.run.sourceStatuses[.microphone] = .revoked
        b.run.state = .permissionRevoked
        await b.engine.step()
        t.expectEqual(b.engine.snapshot.health(.microphone), .permissionDenied)
        t.expectEqual(b.engine.snapshot.hint, "Grant Microphone in System Settings › Privacy & Security.")
        b.clock.advance(16)
        await b.engine.step()
        t.expectEqual(b.runs.count, 1, "not recoverable yet: no restart")
        b.run.recoverable = true
        b.clock.advance(16)
        await b.engine.step()
        t.expectEqual(b.runs.count, 2, "granted: restarted")
        t.expectEqual(b.engine.snapshot.health(.microphone), .listening)
        t.expect(b.engine.snapshot.hint == nil)
    }

    await t.test("screen recording and speech permission have their own plain lines") {
        var snapshot = EngineSnapshot(stage: .paired, sources: [.screen: .permissionDenied])
        t.expectEqual(snapshot.hint, "Grant Screen Recording in System Settings › Privacy & Security.")
        snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .permissionDenied], speechFailure: .notAuthorized)
        t.expectEqual(snapshot.hint, "Grant Speech Recognition in System Settings › Privacy & Security.")
        snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .unavailable], speechFailure: .onDeviceUnsupported)
        t.expect(snapshot.hint?.contains("on the device") == true, "device-only refusal says why")
    }

    await t.test("a failed speech check marks audio unavailable and never listening, screen is unaffected") {
        let b = Bench()
        b.routes.issues = [b.issued(credentialA)]
        _ = await b.engine.start(sessionId: sessionId, sources: [.microphone, .screen])
        b.run.speechFailure = .notAuthorized
        b.run.state = .speechUnavailable
        b.run.sourceStatuses = [.microphone: .pending, .screen: .running]
        await b.engine.step()
        t.expectEqual(b.engine.snapshot.health(.microphone), .permissionDenied)
        t.expectEqual(b.engine.snapshot.health(.screen), .listening)
        t.expectEqual(b.engine.snapshot.speechFailure, .notAuthorized)
    }

    await t.test("last-heard age is reported in five-second steps and changes only when it moves") {
        let b = Bench()
        await b.started()
        b.run.lastHeardAt = b.clock.now()
        await b.engine.step()
        t.expectEqual(b.engine.snapshot.lastHeardAgeSeconds, 0)
        let before = b.events.count
        b.clock.advance(3)
        await b.engine.step()
        t.expectEqual(b.events.count, before, "no event for a 3 second drift")
        b.clock.advance(4)
        await b.engine.step()
        t.expectEqual(b.engine.snapshot.lastHeardAgeSeconds, 5)
    }

    await t.test("pause holds the pairing and stops sources; resume listens again without a new credential") {
        let b = Bench()
        await b.started()
        await b.engine.pause()
        t.expect(b.run.discarded && b.engine.snapshot.paused)
        await b.engine.step()
        t.expectEqual(b.routes.issueCalls, 1)
        await b.engine.resume()
        t.expectEqual(b.runs.count, 2)
        t.expect(!b.engine.snapshot.paused)
        t.expectEqual(b.routes.issueCalls, 1, "same credential")
    }

    await t.test("stop is quiet; the person's own stop tells Studio") {
        let b = Bench()
        await b.started()
        await b.engine.stop()
        t.expect(b.run.discarded && !b.run.localStopped)
        t.expect(b.store.value == nil)
        t.expectEqual(b.engine.snapshot.stage, .idle)
        await b.started()
        await b.engine.stopLocally()
        t.expect(b.run.localStopped, "Studio is told capture stopped")
        t.expectEqual(b.engine.snapshot.stage, .stopped)
        await b.engine.step()
        t.expectEqual(b.runs.count, 2, "does not restart on its own")
    }

    await t.test("disconnect revokes at Studio and deletes the credential; a plain quit tells Studio capture stopped") {
        let b = Bench()
        await b.started()
        await b.engine.shutdown(revoke: true)
        t.expectEqual(b.routes.revoked, [sessionId])
        t.expect(b.store.value == nil && b.run.discarded)
        let q = Bench()
        await q.started()
        await q.engine.shutdown(revoke: false)
        t.expect(q.run.localStopped && q.routes.revoked.isEmpty)
    }

    await t.test("engine calls from the page are decoded strictly") {
        func body(_ method: String, _ params: [String: Any]) -> [String: Any] { ["v": 1, "method": method, "params": params] }
        let ok = EngineCallDecoder.decode(body("engineStart", ["sessionId": sessionId, "sources": ["microphone", "screen"]]))
        t.expect(ok == .success(.start(sessionId: sessionId, sources: [.microphone, .screen])))
        t.expect(EngineCallDecoder.decode(body("captureScreen", [:])) == nil, "not an engine method")
        let bad: [[String: Any]] = [
            body("engineStart", ["sessionId": "x", "sources": ["screen"]]),
            body("engineStart", ["sessionId": sessionId, "sources": ["camera"]]),
            body("engineStart", ["sessionId": sessionId, "sources": ["screen", "screen"]]),
            body("engineStart", ["sessionId": sessionId, "sources": ["screen"], "credential": "asc_x"]),
            body("engineStop", ["extra": 1]),
            ["v": 2, "method": "engineStop"],
        ]
        for each in bad { t.expect(EngineCallDecoder.decode(each).map { if case .failure = $0 { true } else { false } } == true, "refused \(each)") }
        t.expect(EngineCallDecoder.decode(["v": 1, "method": "engineStatus"]) == .success(.status))
    }
}
