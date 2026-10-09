import CaptureCore
import Foundation

// The detector on synthetic signals, the same scenarios as
// packages/active-session-contracts/src/voice-activity.test.ts: every signal is
// built from numbers here (a seeded noise, a voiced tone cut into syllables),
// so a run is the same every time and no audio hardware is involved.

private let rate = 16_000

private func count(_ ms: Int, _ sampleRate: Int = rate) -> Int { sampleRate * ms / 1000 }
private func amplitude(_ db: Double) -> Double { pow(10, db / 20) }

// White noise at an RMS level (uniform noise has RMS = peak / sqrt(3)).
private func noise(_ ms: Int, _ db: Double, seed: UInt32 = 7, sampleRate: Int = rate) -> [Float] {
    var state = seed
    let peak = amplitude(db) * 3.0.squareRoot()
    return (0..<count(ms, sampleRate)).map { _ in
        state = state &* 1_664_525 &+ 1_013_904_223
        return Float((Double(state) / 4_294_967_296 * 2 - 1) * peak)
    }
}

private func silence(_ ms: Int, sampleRate: Int = rate) -> [Float] {
    noise(ms, -90, seed: 3, sampleRate: sampleRate)
}

// A voice, near enough: a 140 Hz tone with harmonics at an RMS level, cut
// into syllables (180 ms voiced, 70 ms nearly silent), as speech is.
private func speech(_ ms: Int, _ db: Double, sampleRate: Int = rate) -> [Float] {
    let peak = amplitude(db) * 2.0.squareRoot() * 0.8
    return (0..<count(ms, sampleRate)).map { index in
        let time = Double(index) / Double(sampleRate)
        let voiced = (time * 1000).truncatingRemainder(dividingBy: 250) < 180 ? 1.0 : 0.003
        let tone =
            sin(2 * .pi * 140 * time) + 0.5 * sin(2 * .pi * 280 * time) + 0.25 * sin(2 * .pi * 420 * time)
        return Float(voiced * peak * tone)
    }
}

private struct Change: Equatable {
    let atMs: Int
    let speaking: Bool
}

// Runs a signal through a detector in frames and gives back when `speaking`
// changed, in milliseconds of audio.
private func changes(_ signal: [Float], frame: Int = 320, sampleRate: Int = rate) -> [Change] {
    var detector = VoiceActivityDetector()
    var out: [Change] = []
    var was = false
    var from = 0
    while from < signal.count {
        let to = min(from + frame, signal.count)
        let now = detector.push(AudioFrame(samples: Array(signal[from..<to]), sampleRate: sampleRate))
        if now != was {
            was = now
            out.append(Change(atMs: Int((Double(to) / Double(sampleRate) * 1000).rounded()), speaking: now))
        }
        from = to
    }
    return out
}

// 100 ms frames of a signal, as the call's audio arrives.
private func frames(_ signal: [Float]) -> [AudioFrame] {
    stride(from: 0, to: signal.count, by: 1_600).map {
        AudioFrame(samples: Array(signal[$0..<min($0 + 1_600, signal.count)]), sampleRate: rate)
    }
}

private func voiceReports(_ transport: ScriptedTransport) async -> [(source: String, speaking: Bool)] {
    await transport.requests.compactMap { request in
        guard case .object(let fields)? = envelopeJSON(of: request), fields["kind"] == .string("voice.activity"),
            case .string(let source)? = fields["source"], case .bool(let speaking)? = fields["speaking"]
        else { return nil }
        return (source, speaking)
    }
}

// Accepts everything, answering a voice-activity report with its own event id.
private let takesVoice: ScriptedTransport.Responder = { request in
    guard stringField(envelopeJSON(of: request), "kind") == "voice.activity" else {
        return acceptedResult(for: request)
    }
    let body =
        #"{"version":1,"status":"accepted","sourceId":"companion-r1","eventId":"voice-activity","control":\#(controlJSON("active"))}"#
    return .response(status: 200, body: Data(body.utf8), retryAfterSeconds: nil)
}

@MainActor
func voiceActivityTests(_ t: Harness) async {
    await detectorTests(t)
    await sharedVectorTests(t)
    await detectorEdgeTests(t)
    await reporterAndWireTests(t)
    await sessionVoiceTests(t)
    await sessionVoiceRefusalTests(t)
}

private let startMs = VoiceActivityTuning.startMs
private let hangoverMs = VoiceActivityTuning.hangoverMs

@MainActor
private func detectorTests(_ t: Harness) async {
    await t.test("Swift voice-activity tuning equals VOICE_ACTIVITY_TUNING in voice-activity.ts") {
        let url = contractsRoot().appendingPathComponent("src/voice-activity.ts")
        let source = try String(contentsOf: url, encoding: .utf8)
        guard let open = source.range(of: "VOICE_ACTIVITY_TUNING = Object.freeze({"),
            let close = source.range(of: "});", range: open.upperBound..<source.endIndex)
        else { throw TestError("tuning block not found") }
        var parsed: [String: Int] = [:]
        for line in source[open.upperBound..<close.lowerBound].split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("//"), let colon = trimmed.firstIndex(of: ":"), trimmed.hasSuffix(",")
            else { continue }
            let value = trimmed[trimmed.index(after: colon)...].dropLast().trimmingCharacters(in: .whitespaces)
            if let number = Int(value.replacingOccurrences(of: "_", with: "")) {
                parsed[String(trimmed[..<colon])] = number
            }
        }
        t.expect(parsed.count >= 11, "parsed \(parsed.count) numbers")
        t.expectEqual(parsed, VoiceActivityTuning.all)
    }

    await t.test("hears nothing in silence, and does not read a steady noise as a voice") {
        t.expectEqual(changes(silence(10_000)), [])
        t.expectEqual(changes([Float](repeating: 0, count: count(5_000))), [])
        // A fan, a hum, a call's comfort noise: loud, but never dipping.
        t.expectEqual(changes(noise(20_000, -40)), [])
        t.expectEqual(changes(noise(20_000, -25)), [])
    }

    await t.test("lets a noise that starts in a quiet room go once it has become the floor") {
        let heard = changes(silence(2_000) + noise(20_000, -38))
        t.expect(heard.count <= 2, "changed \(heard.count) times")
        if let stopped = heard.first(where: { !$0.speaking }) {
            t.expect(stopped.atMs - 2_000 <= VoiceActivityTuning.floorWindowMs + hangoverMs + 200, "\(stopped.atMs)")
        } else {
            t.expect(heard.isEmpty, "started and never stopped")
        }
    }

    await t.test("starts soon after a voice does and stops soon after it does") {
        let heard = changes(silence(1_000) + speech(2_000, -26) + silence(2_000))
        t.expectEqual(heard.map(\.speaking), [true, false])
        guard heard.count == 2 else { return }
        t.expect(heard[0].atMs - 1_000 >= startMs && heard[0].atMs - 1_000 <= startMs + 150, "start \(heard[0].atMs)")
        // The last syllable ends 70 ms before the voice does.
        t.expect(
            heard[1].atMs - 3_000 >= hangoverMs - 100 && heard[1].atMs - 3_000 <= hangoverMs + 60,
            "stop \(heard[1].atMs)")
    }

    await t.test("does not read a short dip inside a sentence as a stop") {
        // A breath: shorter than the hangover.
        let heard = changes(
            silence(1_000) + speech(1_500, -26) + silence(300) + speech(1_500, -26) + silence(1_500))
        t.expectEqual(heard.map(\.speaking), [true, false])
        t.expect((heard.last?.atMs ?? 0) > 4_300, "stopped at \(heard.last?.atMs ?? 0)")
    }

    await t.test("reads a long pause as a stop, and the voice after it as a new start") {
        let heard = changes(
            silence(1_000) + speech(1_500, -26) + silence(1_200) + speech(1_500, -26) + silence(1_500))
        t.expectEqual(heard.map(\.speaking), [true, false, true, false])
        guard heard.count == 4 else { return }
        t.expect(heard[1].atMs > 2_500 && heard[1].atMs < 2_500 + hangoverMs + 100, "stop \(heard[1].atMs)")
        t.expect(
            heard[2].atMs >= 3_700 + startMs && heard[2].atMs <= 3_700 + startMs + 150, "restart \(heard[2].atMs)")
    }

}

@MainActor
private func sharedVectorTests(_ t: Harness) async {
    // The vectors both detectors answer to: the TypeScript test reads the same
    // file, so the two cannot drift apart in behaviour, only together.
    await t.test("reproduces every shared detector vector exactly") {
        let url = contractsRoot().appendingPathComponent("corpus/vectors/voice-activity.json")
        guard case .object(let root)? = JSONValue.parse(try Data(contentsOf: url)),
            case .number(let sampleRate)? = root["sampleRate"], case .array(let vectors)? = root["vectors"]
        else { throw TestError("vectors unreadable") }
        t.expect(vectors.count >= 10, "\(vectors.count) vectors")
        for vector in vectors {
            guard case .object(let fields) = vector, case .string(let name)? = fields["name"],
                case .array(let segments)? = fields["segments"], case .array(let expected)? = fields["changes"]
            else { throw TestError("vector malformed") }
            var signal: [Float] = []
            for case .object(let segment) in segments {
                guard case .number(let db)? = segment["db"], case .number(let ms)? = segment["ms"] else { continue }
                signal += [Float](repeating: Float(amplitude(db)), count: count(Int(ms), Int(sampleRate)))
            }
            let wanted: [Change] = expected.compactMap { change in
                guard case .object(let fields) = change, case .number(let atMs)? = fields["atMs"],
                    case .bool(let speaking)? = fields["speaking"]
                else { return nil }
                return Change(atMs: Int(atMs), speaking: speaking)
            }
            t.expectEqual(changes(signal, frame: count(20, Int(sampleRate)), sampleRate: Int(sampleRate)), wanted, name)
        }
    }
}

@MainActor
private func detectorEdgeTests(_ t: Harness) async {
    await t.test("stays on through twenty seconds of unbroken talk") {
        let heard = changes(silence(500) + speech(20_000, -24) + silence(1_500))
        t.expectEqual(heard.map(\.speaking), [true, false])
        t.expect((heard.last?.atMs ?? 0) > 20_500)
    }

    await t.test("hears a voice over a steady noise, a quiet voice, and not a hiss or separate clicks") {
        let room = noise(7_000, -45)
        let voice = [Float](repeating: 0, count: count(3_000)) + speech(2_000, -24)
        let mixed = room.enumerated().map { $0.element + ($0.offset < voice.count ? voice[$0.offset] : 0) }
        let heard = changes(mixed)
        t.expectEqual(heard.map(\.speaking), [true, false])
        if heard.count == 2 {
            t.expect(heard[0].atMs - 3_000 <= startMs + 150, "start \(heard[0].atMs)")
            t.expect(heard[1].atMs - 5_000 <= hangoverMs + 100, "stop \(heard[1].atMs)")
        }
        t.expectEqual(changes(silence(1_000) + speech(2_000, -40) + silence(1_000)).map(\.speaking), [true, false])
        t.expectEqual(changes(silence(1_000) + speech(2_000, -60) + silence(1_000)), [])
        // A key every 200 ms: 20 ms loud, 180 ms quiet.
        var typing: [Float] = []
        for _ in 0..<50 { typing += noise(20, -15, seed: 11) + silence(180) }
        t.expectEqual(changes(typing), [])
    }

    await t.test("reads the same signal the same way whatever the frame length or rate") {
        let at16 = silence(1_000) + speech(2_000, -26) + silence(1_500)
        let reference = changes(at16)
        t.expectEqual(reference.map(\.speaking), [true, false])
        // The microphone's 4096-sample buffers, the tap's 100 ms frames, one sample short of a hop.
        for frame in [319, 1_600, 4_096] {
            let heard = changes(at16, frame: frame)
            t.expectEqual(heard.map(\.speaking), [true, false], "frame \(frame)")
            for (index, change) in heard.enumerated() where index < reference.count {
                let late = change.atMs - reference[index].atMs
                t.expect(late >= 0 && late <= frame * 1000 / rate + 21, "frame \(frame) late by \(late)")
            }
        }
        let at48 =
            silence(1_000, sampleRate: 48_000) + speech(2_000, -26, sampleRate: 48_000)
            + silence(1_500, sampleRate: 48_000)
        let heard = changes(at48, frame: 4_800, sampleRate: 48_000)
        t.expectEqual(heard.map(\.speaking), [true, false])
        if let first = heard.first, let expected = reference.first {
            t.expect(abs(first.atMs - expected.atMs) < 130, "48 kHz start \(first.atMs)")
        }
    }

    await t.test("keeps each source's state to itself, forgets on reset and ignores a frame with no rate") {
        var microphone = VoiceActivityDetector()
        var call = VoiceActivityDetector()
        microphone.push(AudioFrame(samples: silence(500) + speech(1_000, -26), sampleRate: rate))
        call.push(AudioFrame(samples: silence(1_500), sampleRate: rate))
        t.expect(microphone.speaking && !call.speaking)
        microphone.reset()
        t.expect(!microphone.speaking)
        t.expect(!microphone.push(AudioFrame(samples: silence(1_000), sampleRate: rate)))
        var none = VoiceActivityDetector()
        t.expect(!none.push(AudioFrame(samples: speech(1_000, -20), sampleRate: 0)))
    }

}

@MainActor
private func reporterAndWireTests(_ t: Harness) async {
    await t.test("the reporter says where it stands once, then only changes and keep-alives") {
        var reporter = VoiceActivityReporter()
        t.expectEqual(reporter.next(speaking: false, nowMs: 0), false)
        reporter.sent(speaking: false, nowMs: 0)
        t.expectEqual(reporter.next(speaking: false, nowMs: 500), nil)
        t.expectEqual(reporter.next(speaking: true, nowMs: 600), true)
        reporter.sent(speaking: true, nowMs: 600)
        t.expectEqual(reporter.next(speaking: true, nowMs: 600 + VoiceActivityTuning.keepAliveMs - 1), nil)
        t.expectEqual(reporter.next(speaking: true, nowMs: 600 + VoiceActivityTuning.keepAliveMs), true)
        t.expectEqual(reporter.next(speaking: false, nowMs: 2_000), false)
        reporter.sent(speaking: false, nowMs: 2_000)
        t.expectEqual(reporter.next(speaking: false, nowMs: 2_000 + VoiceActivityTuning.idleKeepAliveMs - 1), nil)
        t.expectEqual(reporter.next(speaking: false, nowMs: 2_000 + VoiceActivityTuning.idleKeepAliveMs), false)
        // A report that did not get through is still owed, after a wait.
        var failing = VoiceActivityReporter()
        failing.failed(nowMs: 0)
        t.expectEqual(failing.next(speaking: true, nowMs: VoiceActivityTuning.retryMs - 1), nil)
        t.expectEqual(failing.next(speaking: true, nowMs: VoiceActivityTuning.retryMs), true)
        t.expectEqual(failing.told, nil)
    }

    await t.test("a voice.activity message encodes as the corpus has it and validates") {
        let message = IngestMessage.voiceActivity(
            VoiceActivity(
                sourceId: "companion-1", sentAt: "2026-10-03T10:00:05.000Z", source: .applicationAudio, speaking: true))
        t.expectEqual(
            String(bytes: message.encoded(), encoding: .utf8),
            #"{"kind":"voice.activity","sentAt":"2026-10-03T10:00:05.000Z","source":"application-audio","sourceId":"companion-1","speaking":true,"version":1}"#
        )
        t.expectEqual(WireValidator.validateIngest(data: message.encoded()).value, message)
    }

}

// The session: audio in, reports out.
@MainActor
private func sessionVoiceTests(_ t: Harness) async {
    await t.test("a voice on the call's audio is reported under the session credential, then kept alive, then its stop")
    {
        let h = makeSession(selection: [.microphone, .applicationAudio], responder: takesVoice)
        h.session.start(capability: readyCapability)
        // Before any audio: each source says where it stands, once.
        await h.session.reportVoiceActivity()
        var reports = await voiceReports(h.transport)
        t.expectEqual(reports.map(\.source), ["application-audio", "microphone"])
        t.expect(reports.allSatisfy { !$0.speaking })
        await h.session.reportVoiceActivity()
        t.expectEqual(await voiceReports(h.transport).count, 2, "nothing new, nothing sent")

        // Four seconds of the interviewer talking, in 100 ms frames, one pass every 250 ms.
        let talk = frames(silence(500) + speech(4_000, -26) + silence(1_500))
        for (index, frame) in talk.enumerated() {
            h.session.hearAudio(source: .applicationAudio, frames: [frame])
            h.session.hearAudio(source: .microphone, frames: frames(silence(100)))
            h.clock.advance(0.1)
            if index % 5 == 4 || index % 5 == 1 { await h.session.reportVoiceActivity() }
        }
        reports = Array(await voiceReports(h.transport).dropFirst(2))
        t.expect(reports.allSatisfy { $0.source == "application-audio" }, "the quiet microphone said nothing more")
        // A start, a keep-alive about each second of the four, and the stop.
        t.expectEqual(reports.first?.speaking, true)
        t.expectEqual(reports.last?.speaking, false)
        let kept = reports.filter(\.speaking).count
        t.expect(kept >= 4 && kept <= 6, "\(kept) speaking reports")
        t.expectEqual(reports.filter { !$0.speaking }.count, 1)
        t.expect(!h.session.voiceSpeaking(.applicationAudio) && !h.session.voiceSpeaking(.microphone))
        t.expectEqual(h.session.voiceTotals(.applicationAudio).starts, 1)
        t.expect(h.session.voiceTotals(.applicationAudio).voicedMs >= 3_800, "voiced for most of the talk")
        t.expectEqual(h.session.voiceTotals(.microphone), VoiceActivityTotals())

        // [SAFETY] The same credential, route and header as every other
        // message; never queued, and nothing of the audio is in it.
        let sent = await h.transport.requests.filter { stringField(envelopeJSON(of: $0), "kind") == "voice.activity" }
        t.expect(sent.allSatisfy { $0.headers["Authorization"] == "Bearer \(testCredential)" })
        t.expect(sent.allSatisfy { $0.url.absoluteString.hasSuffix("/sessions/ingest") })
        t.expect(sent.allSatisfy { $0.body.count < 200 }, "a report is a few fields")
        t.expect(h.session.outbox.isEmpty, "a report is never an observation")
    }

}

@MainActor
private func sessionVoiceRefusalTests(_ t: Harness) async {
    await t.test("a Studio that refuses voice activity is told nothing more for the run, while detection carries on") {
        for code in ["voice_activity_off", "invalid_observation"] {
            let h = makeSession(
                selection: [.applicationAudio],
                responder: { request in
                    stringField(envelopeJSON(of: request), "kind") == "voice.activity"
                        ? refusedResult(code, state: "active") : acceptedResult(for: request)
                })
            h.session.start(capability: readyCapability)
            await h.session.reportVoiceActivity()
            t.expect(h.session.voiceActivityRefused, code)
            for frame in frames(silence(500) + speech(2_000, -26)) {
                h.session.hearAudio(source: .applicationAudio, frames: [frame])
                h.clock.advance(0.1)
                await h.session.reportVoiceActivity()
            }
            t.expectEqual(await voiceReports(h.transport).count, 1, "\(code): one report, then none")
            // What the event log's totals are made of is still measured.
            t.expectEqual(h.session.voiceTotals(.applicationAudio).starts, 1)
        }
    }

    await t.test("a report that does not get through is said again later, and never queued") {
        let h = makeSession(selection: [.applicationAudio], responder: { _ in .unreachable })
        h.session.start(capability: readyCapability)
        await h.session.reportVoiceActivity()
        await h.session.reportVoiceActivity()
        t.expectEqual(await voiceReports(h.transport).count, 1, "held back after a failure")
        t.expect(!h.session.voiceActivityRefused)
        t.expect(h.session.outbox.isEmpty)
        await h.transport.set(takesVoice)
        h.clock.advance(Double(VoiceActivityTuning.retryMs) / 1000)
        await h.session.reportVoiceActivity()
        t.expectEqual(await voiceReports(h.transport).count, 2)
        // A rate-limited answer is a wait too, not a refusal of the feature.
        await h.transport.set { _ in refusedResult("rate_limited", state: "active", status: 429) }
        h.clock.advance(Double(VoiceActivityTuning.idleKeepAliveMs) / 1000)
        await h.session.reportVoiceActivity()
        t.expect(!h.session.voiceActivityRefused)
    }

    await t.test("nothing is heard or reported while paused, for a lost source, or for the screen") {
        let h = makeSession(selection: [.microphone, .applicationAudio, .screen], responder: takesVoice)
        // Not started: not capturing.
        h.session.hearAudio(source: .applicationAudio, frames: frames(speech(1_000, -26)))
        await h.session.reportVoiceActivity()
        t.expect(!h.session.voiceSpeaking(.applicationAudio))
        t.expectEqual(await voiceReports(h.transport).count, 0)

        h.session.start(capability: readyCapability)
        h.session.hearAudio(source: .screen, frames: frames(speech(1_000, -26)))
        t.expect(!h.session.voiceSpeaking(.screen))
        h.session.hearAudio(source: .applicationAudio, frames: frames(silence(300) + speech(1_000, -26)))
        t.expect(h.session.voiceSpeaking(.applicationAudio))
        await h.session.reportVoiceActivity()
        // The call's audio is lost mid-voice: its state is forgotten and Studio is told it stopped.
        h.session.sourceLost(.applicationAudio, reason: .deviceLost)
        h.session.hearAudio(source: .applicationAudio, frames: frames(speech(500, -26)))
        await h.session.reportVoiceActivity()
        t.expect(!h.session.voiceSpeaking(.applicationAudio))
        let reports = await voiceReports(h.transport).filter { $0.source == "application-audio" }
        t.expectEqual(reports.map(\.speaking), [true, false])
    }
}
