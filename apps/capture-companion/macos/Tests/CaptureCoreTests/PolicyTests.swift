import Foundation
import CaptureCore

private struct Frame: PerceptualFrame {
    let lumaGrid: [UInt8]
    // A gradient whose direction flips per variant, so hashes differ a lot.
    static func gradient(descending: Bool) -> Frame {
        Frame(lumaGrid: (0..<72).map { index in
            let column = UInt8(index % 9)
            return descending ? 255 - column * 20 : column * 20
        })
    }
}

private struct StubSpeech: SpeechCapabilityProbe {
    let result: SpeechProbeResult
    func probe(locale: String) async -> SpeechProbeResult { result }
}

private struct StubPermissions: PermissionProbe {
    func microphone() async -> PermissionState { .granted }
    func screen() async -> PermissionState { .notDetermined }
}

@MainActor
func policyTests(_ t: Harness) async {
    await t.test("a named window that is not on screen is refused, never widened to the display") {
        let titles: [String?] = ["Mail", nil, "Interview Notes - Editor"]
        t.expectEqual(ScreenTarget.choose(titleFragment: "interview notes", windowTitles: titles), .window(index: 2))
        t.expectEqual(ScreenTarget.choose(titleFragment: nil, windowTitles: titles), .display)
        t.expectEqual(ScreenTarget.choose(titleFragment: "Interveiw", windowTitles: titles), .windowNotFound)
        t.expectEqual(ScreenTarget.choose(titleFragment: "Interview", windowTitles: []), .windowNotFound)
    }

    await t.test("backoff doubles with jitter, caps, and honours Retry-After") {
        var low = Backoff(random: { 0 })
        t.expectEqual([low.nextDelay(), low.nextDelay(), low.nextDelay()], [0.5, 1.0, 2.0])
        var high = Backoff(baseSeconds: 1, capSeconds: 8, random: { 0.999_999_9 })
        let delays = (0..<6).map { _ in high.nextDelay() }
        t.expect(delays.allSatisfy { $0 <= 8 }, "capped: \(delays)")
        t.expect(delays[5] > 7.9, "reaches the cap")
        var retry = Backoff(random: { 0 })
        t.expectEqual(retry.nextDelay(retryAfterSeconds: 30), 30)
        t.expectEqual(retry.nextDelay(retryAfterSeconds: 100_000), 600, "Retry-After is clamped")
        retry.reset()
        t.expectEqual(retry.failures, 0)
    }

    await t.test("ring buffer is bounded, reports overflow and zeroes on drop") {
        let buffer = AudioRingBuffer(maxSeconds: 2)
        let second = AudioFrame(samples: Array(repeating: 0.5, count: 1000), sampleRate: 1000)
        t.expect(buffer.push(second) == nil)
        t.expect(buffer.push(second) == nil)
        t.expectEqual(buffer.push(second), AudioOverflow(droppedMs: 1000))
        t.expectEqual(buffer.bufferedMs, 2000)
        buffer.drop(reason: .paused)
        t.expect(buffer.isEmpty && buffer.bufferedMs == 0)
        t.expectEqual(buffer.lastDropReason, .paused)
        for reason in [AudioDropReason.stopped, .permissionRevoked, .credentialExpired] {
            buffer.push(second)
            buffer.drop(reason: reason)
            t.expectEqual(buffer.lastDropReason, reason)
            t.expect(buffer.drain().isEmpty)
        }
    }

    await t.test("the ring buffer source imports nothing and names no file API") {
        let url = repositoryRoot().appendingPathComponent(
            "apps/capture-companion/macos/Sources/CaptureCore/AudioRingBuffer.swift")
        let source = try String(contentsOf: url, encoding: .utf8)
        let code = source.split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }.joined(separator: "\n")
        for forbidden in ["import ", "FileManager", "FileHandle", "write(to", "URL(", "NSKeyedArchiver", "UserDefaults"] {
            t.expect(!code.contains(forbidden), "AudioRingBuffer.swift contains \(forbidden)")
        }
    }

    await t.test("screenshot change policy: change, interval and per-session cap") {
        let start = Date(timeIntervalSince1970: 1_790_000_000)
        var policy = ChangePolicy(distanceThreshold: 10, minimumInterval: 15, sessionCap: 2)
        let a = Frame.gradient(descending: false)
        let b = Frame.gradient(descending: true)
        t.expectEqual(policy.evaluate(a, at: start), .send)
        t.expectEqual(policy.evaluate(b, at: start.addingTimeInterval(5)), .skipTooSoon)
        t.expectEqual(policy.evaluate(a, at: start.addingTimeInterval(20)), .skipUnchanged)
        t.expectEqual(policy.evaluate(b, at: start.addingTimeInterval(40)), .send)
        t.expectEqual(policy.evaluate(a, at: start.addingTimeInterval(80)), .skipSessionCap)
        t.expectEqual(policy.evaluate(Frame(lumaGrid: [1, 2, 3]), at: start), .skipUnreadableFrame)
        let big = ChangePolicy(sessionCap: 10_000)
        t.expectEqual(big.sessionCap, ActiveSessionLimits.maxScreenshotsPerSession, "cap never exceeds the contract limit")
    }

    await t.test("capability check fails visibly in order and builds a valid report") {
        func outcome(_ result: SpeechProbeResult) async -> CapabilityOutcome {
            await CapabilityCheck.evaluate(
                locale: "en_GB", speech: StubSpeech(result: result), permissions: StubPermissions(),
                sourceId: "companion-r1", sentAt: "2026-10-03T10:00:00.000Z")
        }
        let ok = SpeechProbeResult(localeSupported: true, onDeviceSupported: true, recognizerAvailable: true, authorization: .authorized)
        let ready = await outcome(ok)
        t.expect(ready.failure == nil && ready.mayStartAudioSources)
        let cases: [(SpeechProbeResult, SpeechFailure)] = [
            (SpeechProbeResult(localeSupported: false, onDeviceSupported: true, recognizerAvailable: true, authorization: .authorized), .localeUnsupported),
            (SpeechProbeResult(localeSupported: true, onDeviceSupported: false, recognizerAvailable: true, authorization: .authorized), .onDeviceUnsupported),
            (SpeechProbeResult(localeSupported: true, onDeviceSupported: true, recognizerAvailable: false, authorization: .authorized), .recognizerUnavailable),
            (SpeechProbeResult(localeSupported: true, onDeviceSupported: true, recognizerAvailable: true, authorization: .denied), .notAuthorized),
            (SpeechProbeResult(localeSupported: true, onDeviceSupported: true, recognizerAvailable: true, authorization: .notDetermined), .notAuthorized),
        ]
        for (result, expected) in cases {
            let failed = await outcome(result)
            t.expectEqual(failed.failure, expected)
            t.expect(!failed.mayStartAudioSources)
            // The report is always sent and is a valid wire message.
            t.expect(WireValidator.validateIngest(IngestMessage.capabilityReport(failed.report).json).value != nil)
        }
        t.expectEqual(ready.report.speech.authorizationStatus, .authorized)
        t.expectEqual(ready.report.screen, .notDetermined)
    }

    await t.test("state: a revoked source is never listening; selection cannot grow; terminal is final") {
        let machine = CompanionStateMachine(selection: [.microphone, .screen])
        t.expectEqual(machine.state, .idle)
        t.expect(machine.markRunning(.microphone) && machine.markRunning(.screen))
        t.expectEqual(machine.state, .listening)
        t.expect(!machine.markRunning(.applicationAudio), "unselected source cannot start")
        machine.markLost(.microphone, reason: .permissionRevoked)
        t.expectEqual(machine.state, .permissionRevoked)
        t.expect(!machine.isCapturing)
        t.expect(!machine.markRunning(.microphone), "a revoked source is not restarted blindly")
        machine.markLost(.screen, reason: .deviceLost)
        t.expectEqual(machine.state, .permissionRevoked, "revocation outranks a lost device")
        machine.stopLocally()
        t.expectEqual(machine.state, .stoppedLocally)
        machine.endByStudio()
        t.expectEqual(machine.state, .stoppedLocally, "first terminal state wins")
        t.expect(!machine.markRunning(.screen))
        let failing = CompanionStateMachine(selection: [.microphone])
        failing.capabilityFailed(.onDeviceUnsupported)
        t.expectEqual(failing.state, .speechUnavailable)
        t.expect(!failing.markRunning(.microphone))
    }
}
