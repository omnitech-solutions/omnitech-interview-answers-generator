import Foundation
import CaptureCore

private let region = #"{"x":0.1,"y":0.2,"width":0.5,"height":0.4}"#

private func controlWithCapture(_ capture: String, state: String = "active") -> String {
    #"{"state":"\#(state)","credentialExpiresAt":"2026-10-03T12:00:00.000Z","capture":\#(capture)}"#
}

private func ackJSON(capture: String) -> String {
    #"{"version":1,"status":"accepted","sourceId":"s","eventId":"heartbeat","control":\#(controlWithCapture(capture))}"#
}

private func parsedControl(_ capture: String) -> WireResult<Acknowledgement> {
    WireValidator.validateAcknowledgement(data: Data(ackJSON(capture: capture).utf8))
}

// An accepted answer that also hands over a capture request.
private func acceptedWithCapture(_ request: OutgoingRequest, capture: String, state: String = "active") -> TransportResult {
    let envelope = envelopeJSON(of: request)
    let sourceId = stringField(envelope, "sourceId") ?? "x"
    var eventId = stringField(envelope, "eventId")
    if eventId == nil { eventId = stringField(envelope, "kind") == "heartbeat" ? "heartbeat" : "capability" }
    let body = #"{"version":1,"status":"accepted","sourceId":"\#(sourceId)","eventId":"\#(eventId ?? "x")","control":\#(controlWithCapture(capture, state: state))}"#
    return .response(status: 200, body: Data(body.utf8), retryAfterSeconds: nil)
}

private let focused = #"{"requestId":"cap-1","mode":"focused-window"}"#
private let jpegBytes = Data([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])

private func screenshotRequestIds(_ transport: ScriptedTransport) async -> [String?] {
    var ids: [String?] = []
    for request in await transport.requests where stringField(envelopeJSON(of: request), "kind") == "screen.snapshot" {
        if case .object(let fields)? = envelopeJSON(of: request), case .object(let content)? = fields["content"],
            case .string(let id)? = content["requestId"]
        {
            ids.append(id)
        } else {
            ids.append(nil)
        }
    }
    return ids
}

@MainActor
func captureRequestTests(_ t: Harness) async {
    await t.test("control.capture parses each mode and re-encodes to the same JSON") {
        for capture in [focused, #"{"requestId":"cap-1","mode":"display"}"#, #"{"requestId":"cap-1","mode":"region","region":\#(region)}"#] {
            guard case .ok(let ack) = parsedControl(capture) else {
                t.expect(false, "\(capture) should parse")
                continue
            }
            t.expectEqual(ack.control?.capture?.requestId, "cap-1")
            t.expectEqual(JSONValue.parse(ack.json.canonicalData()), JSONValue.parse(Data(ackJSON(capture: capture).utf8)), capture)
        }
        guard case .ok(let ack) = parsedControl(#"{"requestId":"r","mode":"region","region":\#(region)}"#) else {
            t.expect(false, "region parses")
            return
        }
        t.expectEqual(ack.control?.capture, CaptureRequest(requestId: "r", mode: .region, region: CaptureRegion(x: 0.1, y: 0.2, width: 0.5, height: 0.4)))
        // An acknowledgement without a capture is unchanged (additive field).
        t.expectEqual(WireValidator.validateAcknowledgement(data: Data(#"{"version":1,"status":"accepted","sourceId":"s","eventId":"e","control":\#(controlJSON("active"))}"#.utf8)).value?.control?.capture, nil)
    }

    await t.test("control.capture refuses a region off the display, a mode mismatch and unknown fields") {
        let bad = [
            #"{"requestId":"r","mode":"region"}"#,
            #"{"requestId":"r","mode":"display","region":\#(region)}"#,
            #"{"requestId":"r","mode":"focused-window","region":\#(region)}"#,
            #"{"requestId":"r","mode":"region","region":{"x":0.6,"y":0,"width":0.5,"height":0.5}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":0,"y":0.7,"width":0.5,"height":0.4}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":-0.1,"y":0,"width":0.5,"height":0.5}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":0,"y":0,"width":0,"height":0.5}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":0,"y":0,"width":1.5,"height":0.5}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":"0","y":0,"width":0.5,"height":0.5}}"#,
            #"{"requestId":"r","mode":"region","region":{"x":0,"y":0,"width":0.5,"height":0.5,"extra":1}}"#,
            #"{"requestId":"r","mode":"window"}"#,
            #"{"requestId":"bad id","mode":"display"}"#,
            #"{"requestId":"r","mode":"display","title":"x"}"#,
            #"{"mode":"display"}"#,
        ]
        for capture in bad { t.expect(parsedControl(capture).value == nil, "\(capture) must be refused") }
    }

    await t.test("a screenshot carries requestId only when given, validates, and encodes it") {
        let content = { (id: String?) in
            ScreenContent(payloadRef: "shot-1", mediaType: .jpeg, byteLength: 4, windowLabel: "Editor", requestId: id)
        }
        let envelope = Envelope(sourceId: "screen-r1", eventId: "e1", occurredAt: "2026-10-03T10:00:00.000Z", sequence: 0)
        let tagged = Observation(envelope: envelope, body: .screenSnapshot(content("cap-1")))
        let plain = Observation(envelope: envelope, body: .screenSnapshot(content(nil)))
        guard case .object(let taggedFields) = tagged.json, case .object(let taggedContent)? = taggedFields["content"],
            case .object(let plainFields) = plain.json, case .object(let plainContent)? = plainFields["content"]
        else {
            t.expect(false, "objects")
            return
        }
        t.expectEqual(taggedContent["requestId"], .string("cap-1"))
        t.expect(plainContent["requestId"] == nil, "no requestId unless given")
        t.expectEqual(WireValidator.validateIngest(tagged.json).value, .observation(tagged))
        var badContent = taggedContent
        badContent["requestId"] = .string("bad id")
        var bad = taggedFields
        bad["content"] = .object(badContent)
        t.expect(WireValidator.validateIngest(.object(bad)).value == nil, "an invalid requestId is refused")
    }

    await t.test("the inbox takes each request id once and a newer id replaces a waiting one") {
        let inbox = CaptureRequestInbox()
        let one = CaptureRequest(requestId: "a", mode: .display)
        let two = CaptureRequest(requestId: "b", mode: .focusedWindow)
        t.expectEqual(inbox.take(), nil)
        inbox.offer(one)
        inbox.offer(one)
        t.expectEqual(inbox.take(), one)
        t.expectEqual(inbox.take(), nil, "taken once")
        inbox.offer(one)
        t.expectEqual(inbox.take(), nil, "a repeat of a taken id is ignored")
        inbox.offer(one)
        inbox.offer(two)
        t.expectEqual(inbox.take(), two, "the newer request wins")
        inbox.offer(nil)
        t.expectEqual(inbox.take(), nil)
    }

    await t.test("a region is cropped inside the display's own pixels and never widens") {
        let half = CaptureGeometry.cropRect(CaptureRegion(x: 0.25, y: 0.5, width: 0.5, height: 0.25), imageWidth: 2000, imageHeight: 1000)
        t.expectEqual(half, PixelRect(x: 500, y: 500, width: 1000, height: 250))
        let whole = CaptureGeometry.cropRect(CaptureRegion(x: 0, y: 0, width: 1, height: 1), imageWidth: 640, imageHeight: 480)
        t.expectEqual(whole, PixelRect(x: 0, y: 0, width: 640, height: 480))
        // Rounding never leaves the image, and a sliver is at least one pixel.
        let edge = CaptureGeometry.cropRect(CaptureRegion(x: 0.999, y: 0.999, width: 0.001, height: 0.001), imageWidth: 100, imageHeight: 100)
        t.expectEqual(edge, PixelRect(x: 99, y: 99, width: 1, height: 1))
        let over = CaptureGeometry.cropRect(CaptureRegion(x: 0.9, y: 0.9, width: 0.5, height: 0.5), imageWidth: 100, imageHeight: 100)
        t.expectEqual(over, PixelRect(x: 90, y: 90, width: 10, height: 10), "clamped to the display")
        for bad in [
            CaptureRegion(x: -0.1, y: 0, width: 0.5, height: 0.5), CaptureRegion(x: 0, y: 0, width: 0, height: 0.5),
            CaptureRegion(x: .nan, y: 0, width: 0.5, height: 0.5), CaptureRegion(x: 0, y: 0, width: .infinity, height: 1),
        ] {
            t.expectEqual(CaptureGeometry.cropRect(bad, imageWidth: 100, imageHeight: 100), nil)
        }
        t.expectEqual(CaptureGeometry.cropRect(CaptureRegion(x: 0, y: 0, width: 1, height: 1), imageWidth: 0, imageHeight: 10), nil)
    }

    await t.test("the focused window is the frontmost app's largest on-screen layer-0 window, or nothing") {
        func window(_ pid: Int32, layer: Int = 0, onScreen: Bool = true, _ width: Double, _ height: Double) -> WindowCandidate {
            WindowCandidate(ownerPid: pid, layer: layer, isOnScreen: onScreen, width: width, height: height)
        }
        let windows = [
            window(1, 3000, 2000),                       // another app, larger
            window(2, 800, 600),                         // frontmost, small
            window(2, 1400, 900),                        // frontmost, largest
            window(2, layer: 25, 1500, 1000),            // frontmost but a floating layer
            window(2, onScreen: false, 2000, 1500),      // frontmost but not on screen
            window(2, 30, 20),                           // a tooltip
        ]
        t.expectEqual(FocusedWindow.choose(frontmostPid: 2, windows: windows), 2)
        t.expectEqual(FocusedWindow.choose(frontmostPid: 3, windows: windows), nil, "never another app's window")
        t.expectEqual(FocusedWindow.choose(frontmostPid: nil, windows: windows), nil)
        t.expectEqual(FocusedWindow.choose(frontmostPid: 2, windows: [window(2, layer: 25, 900, 700)]), nil, "no layer-0 window is no focused window")
        t.expectEqual(FocusedWindow.choose(frontmostPid: 2, windows: []), nil)
    }

    await t.test("a request handed over on an acknowledgement is taken once and answered by one tagged screenshot") {
        let h = makeSession(selection: [.screen], responder: { acceptedWithCapture($0, capture: focused) })
        h.session.start(capability: nil)
        await h.session.tick()
        guard case .honour(let request) = h.session.takeCaptureRequest() else {
            t.expect(false, "the request is handed to the loop")
            return
        }
        t.expectEqual(request, CaptureRequest(requestId: "cap-1", mode: .focusedWindow))
        t.expectEqual(h.session.takeCaptureRequest(), .nothing, "taken once")
        t.expectEqual(h.session.completeCapture(request, outcome: .image(jpeg: jpegBytes, windowLabel: "Xcode")), .submitted)
        await h.session.tick()
        t.expectEqual(await screenshotRequestIds(h.transport), ["cap-1"])
        let label = (await h.transport.requests).compactMap { envelopeJSON(of: $0) }.compactMap { json -> String? in
            if case .object(let fields) = json, case .object(let content)? = fields["content"], case .string(let value)? = content["windowLabel"] { return value }
            return nil
        }
        t.expectEqual(label, ["Xcode"], "the application name only")
        // Studio still offers the same id on later acknowledgements: ignored.
        h.clock.advance(3)
        await h.session.tick()
        t.expectEqual(h.session.takeCaptureRequest(), .nothing, "a repeat of the id is ignored")
    }

    await t.test("a duplicate acknowledgement never hands over a request") {
        let h = makeSession(selection: [.screen], responder: { request in
            let body = #"{"version":1,"status":"duplicate","original":{"version":1,"status":"accepted","sourceId":"s","eventId":"heartbeat","control":\#(controlWithCapture(focused))}}"#
            _ = request
            return .response(status: 200, body: Data(body.utf8), retryAfterSeconds: nil)
        })
        h.session.start(capability: nil)
        await h.session.tick()
        t.expectEqual(h.session.takeCaptureRequest(), .nothing)
    }

    await t.test("a refusal's control can hand over a request too") {
        let h = makeSession(selection: [.screen], responder: { _ in
            let body = #"{"version":1,"status":"refused","code":"rate_limited","control":\#(controlWithCapture(focused))}"#
            return .response(status: 429, body: Data(body.utf8), retryAfterSeconds: 1)
        })
        h.session.start(capability: nil)
        await h.session.tick()
        t.expectEqual(h.session.takeCaptureRequest(), .honour(CaptureRequest(requestId: "cap-1", mode: .focusedWindow)))
    }

    await t.test("a request is honoured only for a screen source selected at start and still running") {
        let audio = makeSession(selection: [.microphone], responder: { acceptedWithCapture($0, capture: focused) })
        audio.session.start(capability: readyCapability)
        await audio.session.tick()
        t.expectEqual(audio.session.takeCaptureRequest(), .ignored, "no screen source was selected")

        let lost = makeSession(selection: [.screen], responder: { acceptedWithCapture($0, capture: focused) })
        lost.session.start(capability: nil)
        lost.session.sourceLost(.screen, reason: .permissionRevoked)
        await lost.session.tick()
        t.expectEqual(lost.session.takeCaptureRequest(), .ignored, "a revoked screen source captures nothing")
        t.expectEqual(lost.session.completeCapture(CaptureRequest(requestId: "cap-1", mode: .display), outcome: .image(jpeg: jpegBytes, windowLabel: "x")), .dropped)

        let paused = makeSession(selection: [.screen], responder: { acceptedWithCapture($0, capture: focused, state: "paused") })
        paused.session.start(capability: nil)
        await paused.session.tick()
        t.expectEqual(paused.session.takeCaptureRequest(), .ignored, "a paused session captures nothing")

        let ended = makeSession(selection: [.screen], responder: { acceptedWithCapture($0, capture: focused, state: "ended") })
        ended.session.start(capability: nil)
        await ended.session.tick()
        t.expectEqual(ended.session.takeCaptureRequest(), .nothing, "an ended run takes nothing")
    }

    await t.test("a capture that finishes after a pause or stop sends nothing; a loss is visible and sends nothing") {
        let h = makeSession(selection: [.screen], responder: { acceptedWithCapture($0, capture: focused) })
        h.session.start(capability: nil)
        await h.session.tick()
        guard case .honour(let request) = h.session.takeCaptureRequest() else {
            t.expect(false, "handed over")
            return
        }
        t.expectEqual(h.session.completeCapture(request, outcome: .lost(.noFocusedWindow)), .lost(.noFocusedWindow))
        t.expectEqual(h.session.completeCapture(request, outcome: .lost(.captureFailed)), .lost(.captureFailed))
        t.expect(h.session.outbox.isEmpty, "a loss queues nothing: there is no wider capture")
        h.session.localStop()
        t.expectEqual(h.session.completeCapture(request, outcome: .image(jpeg: jpegBytes, windowLabel: "x")), .dropped)
        let screenshots = h.session.outbox.queuedObservations.filter { if case .screenSnapshot = $0.body { return true } else { return false } }
        t.expect(screenshots.isEmpty, "nothing captured is sent after a stop")
    }

    await t.test("the heartbeat pulls every two seconds while the screen runs, and keeps the slower cadence otherwise") {
        let screen = makeSession(selection: [.screen])
        screen.session.start(capability: nil)
        await screen.session.tick()
        func heartbeats(_ transport: ScriptedTransport) async -> Int {
            await transport.requests.filter { stringField(envelopeJSON(of: $0), "kind") == "heartbeat" }.count
        }
        t.expectEqual(await heartbeats(screen.transport), 1)
        screen.clock.advance(1.5)
        await screen.session.tick()
        t.expectEqual(await heartbeats(screen.transport), 1, "not before two seconds")
        screen.clock.advance(0.6)
        await screen.session.tick()
        t.expectEqual(await heartbeats(screen.transport), 2, "two seconds while the screen runs")

        let audio = makeSession(selection: [.microphone])
        audio.session.start(capability: readyCapability)
        await audio.session.tick()
        audio.clock.advance(2.5)
        await audio.session.tick()
        t.expectEqual(await heartbeats(audio.transport), 1, "audio-only keeps the five-second cadence")
        audio.clock.advance(2.6)
        await audio.session.tick()
        t.expectEqual(await heartbeats(audio.transport), 2)
    }
}
