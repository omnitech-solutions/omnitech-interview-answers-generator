import Foundation
import CaptureCore

@MainActor
func sessionTests(_ t: Harness) async {
    await t.test("endpoint puts the credential only in the Authorization header") {
        let endpoint = Endpoint(studioAddress: "https://studio.example.test", tenantSlug: "acme")!
        t.expectEqual(endpoint.ingestURL.absoluteString, "https://studio.example.test/api/interview/t/acme/sessions/ingest")
        let beat = IngestMessage.heartbeat(Heartbeat(sourceId: "c", sentAt: "2026-10-03T10:00:00.000Z", capturing: true))
        let request = endpoint.request(for: beat, credential: testCredential)!
        t.expectEqual(request.headers["Authorization"], "Bearer \(testCredential)")
        t.expectEqual(request.headers["Content-Type"], "application/json")
        t.expect(!request.url.absoluteString.contains(testCredential), "URL carries no credential")
        t.expect(!String(decoding: request.body, as: UTF8.self).contains(testCredential), "body carries no credential")
        t.expect(endpoint.request(for: beat, credential: "not-a-credential") == nil, "malformed credential never sent")
        t.expect(endpoint.request(for: beat, credential: "asc_short") == nil)
    }

    await t.test("endpoint refuses addresses that could carry secrets or downgrade transport") {
        t.expect(Endpoint(studioAddress: "http://studio.example.test", tenantSlug: "acme") == nil, "plain http off loopback")
        t.expect(Endpoint(studioAddress: "http://localhost:3000", tenantSlug: "acme") != nil, "loopback dev Studio")
        t.expect(Endpoint(studioAddress: "https://user:pw@studio.example.test", tenantSlug: "acme") == nil)
        t.expect(Endpoint(studioAddress: "https://studio.example.test/x?token=1", tenantSlug: "acme") == nil)
        t.expect(Endpoint(studioAddress: "https://studio.example.test/app", tenantSlug: "acme") == nil)
        t.expect(Endpoint(studioAddress: "https://studio.example.test", tenantSlug: "a/b") == nil)
        t.expect(Endpoint(studioAddress: "https://studio.example.test", tenantSlug: "") == nil)
    }

    await t.test("a screenshot is multipart with envelope and payload parts") {
        let endpoint = Endpoint(studioAddress: "https://studio.example.test", tenantSlug: "acme")!
        let shot = Observation(
            envelope: Envelope(sourceId: "screen-r1", eventId: "e1", occurredAt: "2026-10-03T10:00:00.000Z", sequence: 0),
            body: .screenSnapshot(ScreenContent(payloadRef: "shot-1", mediaType: .jpeg, byteLength: 4, windowLabel: "Editor")))
        let request = endpoint.request(for: .observation(shot), payload: Data([0xff, 0xd8, 0xff, 0xd9]), credential: testCredential, boundary: "B")!
        let text = String(decoding: request.body, as: UTF8.self)
        t.expect(request.headers["Content-Type"] == "multipart/form-data; boundary=B")
        t.expect(text.contains("name=\"envelope\"") && text.contains("name=\"payload\""))
        t.expect(text.contains("Content-Type: image/jpeg"))
        t.expectEqual(stringField(envelopeJSON(of: request), "eventId"), "e1")
    }

    await t.test("resend after a dropped connection carries the same ids and bytes") {
        let h = makeSession(responder: { _ in .unreachable })
        h.session.start(capability: readyCapability)
        _ = h.session.submitTranscript(source: .microphone, text: "Tell me about a project.", startMs: 0, endMs: 2000)
        _ = h.session.submitTranscript(source: .microphone, text: "What was your role?", startMs: 2500, endMs: 4000)
        await h.session.tick()
        let first = await h.transport.requests.first { stringField(envelopeJSON(of: $0), "kind") == "transcript.final" }
        t.expect(first != nil, "an attempt was made")
        // Backoff holds the queue; time passes; the connection returns.
        await h.transport.set { acceptedResult(for: $0) }
        h.clock.advance(120)
        await h.session.tick()
        let requests = await h.transport.requests
        let transcripts = requests.filter { stringField(envelopeJSON(of: $0), "kind") == "transcript.final" }
        let firstBodies = transcripts.filter { stringField(envelopeJSON(of: $0), "eventId") == "r1-microphone-0" }.map(\.body)
        t.expectEqual(firstBodies.count, 2, "the first observation was sent twice")
        t.expect(firstBodies.count == 2 && firstBodies[0] == firstBodies[1], "identical bytes on resend")
        t.expect(transcripts.contains { stringField(envelopeJSON(of: $0), "eventId") == "r1-microphone-1" }, "sequence 1 follows")
        t.expect(h.session.outbox.isEmpty, "acknowledged observations leave the outbox")
    }

    await t.test("duplicate acks release the outbox; permanent refusals drop; transient ones keep") {
        let factory = ObservationFactory(runId: "r1", clock: FakeClock())
        let outbox = Outbox(capacity: 10, factory: factory)
        func transcript() -> Observation {
            factory.make(.microphone, .transcriptFinal(TranscriptContent(speaker: "microphone", source: .microphone, text: "x", startMs: 0, endMs: 1)))
        }
        let control = ControlStatus(state: .active, credentialExpiresAt: "2026-10-03T12:00:00.000Z")
        let one = transcript()
        outbox.enqueue(one)
        let original = AcceptedAck(sourceId: one.envelope.sourceId, eventId: one.envelope.eventId, control: control)
        t.expectEqual(outbox.handle(.duplicate(original: original), for: one), .delivered)
        t.expect(outbox.isEmpty)
        for code in RefusalCode.allCases {
            let message = transcript()
            outbox.enqueue(message)
            let outcome = outbox.handle(.refused(code: code, control: nil, issues: nil), for: message)
            if code == .rateLimited || code == .sessionPaused {
                t.expectEqual(outcome, .retryLater(afterSeconds: nil), code.rawValue)
                t.expectEqual(outbox.count, 1)
                outbox.clear()
            } else {
                t.expectEqual(outcome, .droppedPermanent(code), code.rawValue)
                t.expect(outbox.isEmpty, "\(code.rawValue) dropped the message")
            }
        }
        let mismatched = transcript()
        outbox.enqueue(mismatched)
        let other = AcceptedAck(sourceId: "other", eventId: "other", control: control)
        t.expectEqual(outbox.handle(.accepted(other), for: mismatched), .retryLater(afterSeconds: nil), "an ack for another event is not trusted")
    }

    await t.test("rate_limited honours Retry-After before the next attempt") {
        let h = makeSession(responder: { _ in refusedResult("rate_limited", state: "active", status: 429, retryAfter: 60) })
        h.session.start(capability: readyCapability)
        _ = h.session.submitTranscript(source: .microphone, text: "Hello there.", startMs: 0, endMs: 500)
        await h.session.tick()
        let transport = h.transport
        func transcriptAttempts() async -> Int {
            await transport.requests.filter { stringField(envelopeJSON(of: $0), "kind") == "transcript.final" }.count
        }
        t.expectEqual(await transcriptAttempts(), 1)
        h.clock.advance(30)
        await h.session.tick()
        t.expectEqual(await transcriptAttempts(), 1, "no resend inside the Retry-After window")
        h.clock.advance(31)
        await h.session.tick()
        t.expectEqual(await transcriptAttempts(), 2, "resent once the window has passed")
        t.expectEqual(h.session.outbox.count, 1, "the message is kept")
    }

    await t.test("outbox overflow records a capture.gap instead of dropping silently") {
        let factory = ObservationFactory(runId: "r1", clock: FakeClock())
        let outbox = Outbox(capacity: 2, factory: factory)
        var results: [EnqueueResult] = []
        for index in 0..<5 {
            let observation = factory.make(.microphone, .transcriptFinal(TranscriptContent(speaker: "microphone", source: .microphone, text: "t\(index)", startMs: index * 1000, endMs: index * 1000 + 800)))
            results.append(outbox.enqueue(observation))
        }
        t.expectEqual(results, [.queued, .queued, .overflowed, .overflowed, .overflowed])
        t.expectEqual(outbox.pendingOverflowSources, [.microphone])
        // Room returns: deliver the head, and the gap becomes an observation.
        let head = outbox.next(now: Date())!
        let control = ControlStatus(state: .active, credentialExpiresAt: "2026-10-03T12:00:00.000Z")
        outbox.handle(.accepted(AcceptedAck(sourceId: head.observation.envelope.sourceId, eventId: head.observation.envelope.eventId, control: control)), for: head.observation)
        _ = outbox.next(now: Date())
        let gaps = outbox.queuedObservations.filter { if case .captureGap(_, 2400, .bufferOverflow) = $0.body { return true } else { return false } }
        t.expectEqual(gaps.count, 1, "one capture.gap of the lost 2400 ms")
        t.expect(WireValidator.validateIngest(gaps.first.map { $0.json } ?? .null).value != nil, "the gap is a valid wire message")
        // Payload bytes are bounded too.
        let small = Outbox(capacity: 10, maxPayloadBytes: 4, factory: factory)
        let shot = factory.make(.screen, .screenSnapshot(ScreenContent(payloadRef: "s", mediaType: .png, byteLength: 8, windowLabel: "")))
        t.expectEqual(small.enqueue(shot, payload: Data(count: 8)), .overflowed)
    }

    await t.test("Studio pause stops sources and drops audio; resume restarts only selected paused sources") {
        let h = makeSession(selection: [.microphone, .applicationAudio, .screen], responder: { _ in .unreachable })
        h.session.start(capability: readyCapability)
        t.expectEqual(h.session.machine.state, .listening)
        h.buffers[0].push(AudioFrame(samples: [0.1, 0.2], sampleRate: 100))
        // The application-audio source is lost; screen keeps running.
        h.session.sourceLost(.applicationAudio, reason: .deviceLost)
        await h.transport.set { acceptedResult(for: $0, state: "paused") }
        await h.session.tick()
        t.expectEqual(h.session.machine.state, .paused)
        t.expect(h.buffers[0].isEmpty && h.buffers[0].lastDropReason != nil, "buffered audio dropped")
        t.expect(h.sources.stopped.contains(.microphone) && h.sources.stopped.contains(.screen))
        h.sources.started.removeAll()
        h.clock.advance(10)
        await h.transport.set { acceptedResult(for: $0, state: "active") }
        await h.session.tick()
        t.expectEqual(Set(h.sources.started), [.microphone, .screen], "the lost source is not restarted")
        t.expectEqual(h.session.machine.state, .sourceLost)
    }

    await t.test("a source Studio refuses is dropped for the run and never restarted") {
        let issues = #"[{"path":["content","source"],"code":"invalid_value"}]"#
        let h = makeSession(selection: [.microphone, .applicationAudio], responder: { request in
            if stringField(envelopeJSON(of: request), "sourceId") == "application-audio-r1" {
                return refusedResult("invalid_observation", state: "active", issuesJSON: issues, status: 422)
            }
            return acceptedResult(for: request)
        })
        h.session.start(capability: readyCapability)
        _ = h.session.submitTranscript(source: .applicationAudio, text: "System audio words.", startMs: 0, endMs: 900)
        await h.session.tick()
        t.expectEqual(h.session.machine.statuses[.applicationAudio], .refused)
        t.expect(h.sources.stopped.contains(.applicationAudio))
        t.expect(h.session.outbox.isEmpty, "the refused message is dropped, not retried")
        // A pause and resume cycle must not bring the refused source back.
        await h.transport.set { acceptedResult(for: $0, state: "paused") }
        h.clock.advance(10)
        await h.session.tick()
        h.sources.started.removeAll()
        await h.transport.set { acceptedResult(for: $0, state: "active") }
        h.clock.advance(10)
        await h.session.tick()
        t.expectEqual(h.sources.started, [.microphone])
    }

    await t.test("an invalid message that does not name a source does not drop the source") {
        let h = makeSession(selection: [.microphone], responder: { _ in
            refusedResult("invalid_observation", state: "active", issuesJSON: #"[{"path":["content","text"],"code":"too_large"}]"#, status: 422)
        })
        h.session.start(capability: readyCapability)
        _ = h.session.submitTranscript(source: .microphone, text: "Words.", startMs: 0, endMs: 100)
        await h.session.tick()
        t.expectEqual(h.session.machine.statuses[.microphone], .running)
        t.expectEqual(h.session.machine.state, .listening)
    }

    await t.test("session ended or purging stops everything and clears the outbox") {
        for code in ["session_ended", "session_purging"] {
            let h = makeSession(responder: { _ in refusedResult(code, state: code == "session_ended" ? "ended" : "purging") })
            h.session.start(capability: readyCapability)
            _ = h.session.submitTranscript(source: .microphone, text: "Words.", startMs: 0, endMs: 100)
            await h.session.tick()
            t.expectEqual(h.session.machine.state, .ended, code)
            t.expect(h.session.outbox.isEmpty, code)
            let count = await h.transport.requestCount()
            await h.session.tick()
            let after = await h.transport.requestCount()
            t.expectEqual(after, count, "nothing is sent after \(code)")
        }
    }

    await t.test("credential_refused stops visibly, deletes the stored credential and keeps nothing") {
        let h = makeSession(responder: { _ in refusedResult("credential_refused", status: 401) })
        h.session.start(capability: readyCapability)
        h.buffers[0].push(AudioFrame(samples: [0.3], sampleRate: 10))
        _ = h.session.submitTranscript(source: .microphone, text: "Words.", startMs: 0, endMs: 100)
        await h.session.tick()
        t.expectEqual(h.session.machine.state, .credentialRefused)
        t.expect(h.credentials.stored == nil, "credential deleted")
        t.expect(h.session.outbox.isEmpty && h.buffers[0].isEmpty)
    }

    await t.test("credential expiry stops capture and drops audio even when Studio is silent") {
        let h = makeSession()
        h.session.start(capability: readyCapability)
        await h.session.tick()
        h.buffers[0].push(AudioFrame(samples: [0.3], sampleRate: 10))
        // Past 2026-10-03T12:00Z, the expiry every ack carries.
        h.clock.date = TimeText.parse("2026-10-03T12:00:01.000Z")!
        await h.session.tick()
        t.expectEqual(h.session.machine.state, .credentialRefused)
        t.expect(h.buffers[0].isEmpty)
    }

    await t.test("permission revocation is visible, drops audio, and is reported; never listening") {
        let h = makeSession(selection: [.microphone, .screen])
        h.session.start(capability: readyCapability)
        h.buffers[0].push(AudioFrame(samples: [0.3], sampleRate: 10))
        h.session.sourceLost(.microphone, reason: .permissionRevoked)
        t.expectEqual(h.session.machine.state, .permissionRevoked)
        t.expect(h.buffers[0].isEmpty)
        await h.session.tick()
        let requests = await h.transport.requests
        let kinds = requests.compactMap { stringField(envelopeJSON(of: $0), "kind") }
        t.expect(kinds.contains("source.disconnected"), "disconnect reported")
        let heartbeat = requests.last { stringField(envelopeJSON(of: $0), "kind") == "heartbeat" }
        if case .object(let fields)? = envelopeJSON(of: heartbeat!) { t.expectEqual(fields["capturing"], .bool(false)) }
    }

    await t.test("a failed on-device capability check starts nothing and never falls back") {
        let h = makeSession(selection: [.microphone, .screen])
        let failed = CapabilityOutcome(report: readyCapability.report, failure: .onDeviceUnsupported)
        t.expect(!h.session.start(capability: failed))
        t.expectEqual(h.session.machine.state, .speechUnavailable)
        t.expect(h.sources.started.isEmpty, "no source started")
        t.expect(!h.session.start(capability: nil), "no check, no audio")
        t.expect(h.session.submitTranscript(source: .microphone, text: "x", startMs: 0, endMs: 1) == nil)
        // A screen-only run needs no speech check.
        let screenOnly = makeSession(selection: [.screen])
        t.expect(screenOnly.session.start(capability: nil))
        t.expectEqual(screenOnly.sources.started, [.screen])
    }

    await t.test("local stop is synchronous, needs no network, zeroes audio and persists a marker") {
        let h = makeSession(selection: [.microphone, .screen], responder: { _ in .unreachable })
        h.session.start(capability: readyCapability)
        h.buffers[0].push(AudioFrame(samples: [0.4, 0.5], sampleRate: 10))
        _ = h.session.submitTranscript(source: .microphone, text: "Late words.", startMs: 0, endMs: 100)
        h.session.localStop()   // no await: it is synchronous
        let calls = await h.transport.requestCount()
        t.expectEqual(calls, 0, "no network call during the stop")
        t.expectEqual(h.session.machine.state, .stoppedLocally)
        t.expect(h.buffers[0].isEmpty && h.buffers[0].lastDropReason == .stopped)
        t.expectEqual(Set(h.sources.stopped), [.microphone, .screen])
        t.expect(h.marker.persistedAt != nil && h.session.stopController.markerPersisted)
        let kinds = h.session.outbox.queuedObservations.map { $0.json }.compactMap { stringField($0, "kind") }
        t.expectEqual(kinds, ["source.disconnected", "source.disconnected"], "only stop notices remain queued; content is dropped")
        // Studio is unavailable: the best-effort notices fail once and are given up.
        await h.session.tick()
        t.expect(h.session.outbox.isEmpty)
        t.expectEqual(h.session.machine.state, .stoppedLocally)
        let after = await h.transport.requestCount()
        await h.session.tick()
        let final = await h.transport.requestCount()
        t.expectEqual(final, after, "no retry loop after a local stop")
    }

    await t.test("a marker write failure never undoes the stop, and the stop is final") {
        let h = makeSession(selection: [.microphone])
        h.marker.fails = true
        h.session.start(capability: readyCapability)
        h.session.localStop()
        t.expectEqual(h.session.machine.state, .stoppedLocally)
        t.expect(!h.session.stopController.markerPersisted)
        // Studio answers "active": a local stop is not resumed by it.
        await h.session.tick()
        await h.session.tick()
        h.sources.started.removeAll()
        t.expectEqual(h.session.machine.state, .stoppedLocally)
        t.expect(h.sources.started.isEmpty, "no auto-resume")
        h.session.localStop()
        t.expectEqual(h.session.stopController.markerPersisted, false)
    }

    await t.test("only counts, ids and states are ever sent as content-free messages: heartbeat spacing") {
        let h = makeSession(selection: [.microphone])
        h.session.start(capability: readyCapability)
        await h.session.tick()
        await h.session.tick()
        let first = await h.transport.requestCount()
        t.expectEqual(first, 1, "second tick inside the interval sends no heartbeat")
        t.expect(h.session.heartbeatIntervalSeconds * 1000 >= Double(ActiveSessionLimits.minHeartbeatIntervalMs))
        h.clock.advance(h.session.heartbeatIntervalSeconds + 0.1)
        await h.session.tick()
        let second = await h.transport.requestCount()
        t.expectEqual(second, 2)
    }
}
