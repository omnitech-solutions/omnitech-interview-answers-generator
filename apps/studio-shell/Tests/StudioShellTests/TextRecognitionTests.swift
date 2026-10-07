import CaptureCore
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import JavaScriptCore
import StudioShellCore
import UniformTypeIdentifiers

// A stand-in for Vision: returns fixed observations, or waits until cancelled.
private struct FakeObserver: TextObserving {
    var isAvailable = true
    var observations: [TextObservation] = []
    var failure: TextRecognitionError?
    var hangs = false

    func observe(_ imageData: Data) async throws -> [TextObservation] {
        if hangs { try await Task.sleep(for: .seconds(60)) }
        if let failure { throw failure }
        return observations
    }
}

// Ignores cancellation entirely (a slow VNRequest.cancel, a long image decode): it only ever
// returns after `delay`, whatever the caller does.
private struct StubbornObserver: TextObserving {
    var isAvailable = true
    var delay: Duration
    func observe(_ imageData: Data) async throws -> [TextObservation] {
        let end = ContinuousClock.now + delay
        while ContinuousClock.now < end { await Task.yield(); try? await Task.sleep(for: .milliseconds(5)) }
        return [TextObservation(text: "late", confidence: 1, box: CGRect(x: 0, y: 0, width: 0.1, height: 0.1))]
    }
}

private func box(_ x: Double, _ y: Double, _ w: Double = 0.2, _ h: Double = 0.05) -> CGRect {
    CGRect(x: x, y: y, width: w, height: h)
}

private func run(_ text: String, _ rect: CGRect, _ confidence: Double = 1) -> TextObservation {
    TextObservation(text: text, confidence: confidence, box: rect)
}

// Renders black text on white into PNG bytes at a fixed font and size.
private func renderedPNG(_ lines: [String], width: Int = 900, height: Int = 260, fontSize: CGFloat = 64) -> Data? {
    guard
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
    var y = CGFloat(height) - fontSize - 24
    for line in lines {
        let attributed = NSAttributedString(
            string: line,
            attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
            ])
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.textPosition = CGPoint(x: 32, y: y)
        CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
        y -= fontSize * 1.4
    }
    guard let image = context.makeImage() else { return nil }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        return nil
    }
    CGImageDestinationAddImage(destination, image, nil)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
}

private func page() -> JSContext {
    let context = JSContext()!
    context.evaluateScript("var window = this; var __posted = [];")
    context.evaluateScript(
        """
        window.webkit = { messageHandlers: { studioHost: {
          postMessage: function (m) { __posted.push(JSON.stringify(m)); return Promise.resolve({ ok: true }); } } } };
        """)
    context.evaluateScript(HostBridgeScript.source(capabilities: HostCapability.allCases))
    return context
}

@MainActor
func textRecognitionTests(_ t: Harness) async {
    func recognizeText(_ params: [String: Any]) -> Result<HostCall, HostCallError> {
        HostCallDecoder.decode(["v": 1, "method": "recognizeText", "params": params] as [String: Any])
    }

    await t.test("recognizeText decodes exactly a known media type and a bounded base64 string") {
        t.expectEqual(
            recognizeText(["mediaType": "image/jpeg", "base64": "AAAA"]),
            .success(.recognizeText(mediaType: "image/jpeg", base64: "AAAA")))
        t.expectEqual(
            recognizeText(["mediaType": "image/png", "base64": "AAAA"]),
            .success(.recognizeText(mediaType: "image/png", base64: "AAAA")))
        let invalid: [[String: Any]] = [
            [:], ["mediaType": "image/jpeg"], ["base64": "AAAA"],
            ["mediaType": "image/gif", "base64": "AAAA"], ["mediaType": 1, "base64": "AAAA"],
            ["mediaType": "image/jpeg", "base64": 12], ["mediaType": "image/jpeg", "base64": ""],
            ["mediaType": "image/jpeg", "base64": "AAAA", "displayId": 1],
            [
                "mediaType": "image/jpeg",
                "base64": String(repeating: "A", count: TextRecognizer.maxBase64Characters + 1),
            ],
        ]
        for params in invalid {
            t.expectEqual(recognizeText(params), .failure(.invalidParameters), "\(params.keys.sorted())")
        }
        let atLimit = String(repeating: "A", count: TextRecognizer.maxBase64Characters)
        t.expectEqual(
            recognizeText(["mediaType": "image/webp", "base64": atLimit]),
            .success(.recognizeText(mediaType: "image/webp", base64: atLimit)))
    }

    await t.test("the capability is advertised only when recognition is available") {
        t.expect(HostCapability.offered(textRecognitionAvailable: true).contains(.textRecognition))
        t.expect(!HostCapability.offered(textRecognitionAvailable: false).contains(.textRecognition))
        t.expectEqual(HostCapability.offered(textRecognitionAvailable: false).count, HostCapability.allCases.count - 1)
        t.expectEqual(HostCapability.textRecognition.rawValue, "text-recognition")
    }

    await t.test(
        "the injected script exposes recognizeText, posts only the image type and text, and types a size refusal"
    ) {
        let context = page()
        t.expectEqual(context.evaluateScript("typeof window.studioHost.recognizeText")?.toString(), "function")
        // A whole capture result goes in; only mediaType and base64 are posted.
        context.evaluateScript(
            "window.studioHost.recognizeText({ ok: true, mediaType: 'image/jpeg', base64: 'AAAA', displayId: 3 });")
        t.expectEqual(
            context.evaluateScript("__posted[0]")?.toString(),
            #"{"v":1,"method":"recognizeText","params":{"mediaType":"image/jpeg","base64":"AAAA"}}"#)
        context.evaluateScript(
            """
            var reply;
            window.studioHost.recognizeText({ mediaType: 'image/jpeg', base64: 'A'.repeat(\(TextRecognizer.maxBase64Characters + 1)) })
              .then(function (r) { reply = r; });
            """)
        t.expectEqual(context.evaluateScript("__posted.length")?.toInt32(), 1, "an oversized image is never posted")
    }

    await t.test("reading order: lines top to bottom, left to right within a line, near-equal heights share a line") {
        // Vision's y grows upward. Scrambled input; the second line's runs sit a little off each other.
        let observations = [
            run("world", box(0.5, 0.80)),
            run("second", box(0.1, 0.60, 0.2, 0.05)),
            run("hello", box(0.1, 0.81)),
            run("line", box(0.35, 0.615, 0.1, 0.05)),
            run("third", box(0.1, 0.40)),
        ]
        let text = ReadingOrder.compose(observations)
        t.expectEqual(text.text, "hello world\nsecond line\nthird")
        t.expect(!text.truncated)
    }

    await t.test("whitespace is normalised, empty runs dropped, confidence is the mean in 0...1") {
        let text = ReadingOrder.compose([
            run("  a \t b\n c ", box(0, 0.9), 0.5), run("   ", box(0, 0.7), 1), run("d", box(0, 0.5), 1),
        ])
        t.expectEqual(text.text, "a b c\nd")
        t.expectEqual(text.confidence, 0.75)
        let empty = ReadingOrder.compose([])
        t.expectEqual(empty.text, "")
        t.expectEqual(empty.confidence, 0)
        t.expect(ReadingOrder.compose([run("x", box(0, 0), 7)]).confidence <= 1)
    }

    await t.test("text is cut at a line boundary with the flag; one oversized line is cut by characters") {
        let lines = (0..<5).map { run("line\($0)", box(0.1, 0.9 - Double($0) * 0.1)) }
        // "line0\nline1\nline2" is 17 characters; a fourth line would make 23.
        let cut = ReadingOrder.compose(lines, maxCharacters: 20)
        t.expectEqual(cut.text, "line0\nline1\nline2")
        t.expect(cut.truncated)
        t.expect(!ReadingOrder.compose(lines, maxCharacters: 29).truncated)
        let single = ReadingOrder.compose([run(String(repeating: "x", count: 50), box(0, 0.5))], maxCharacters: 10)
        t.expectEqual(single.text.count, 10)
        t.expect(single.truncated)
        t.expectEqual(ReadingOrder.maxCharacters, 20_000)
        let big = ReadingOrder.compose(
            (0..<3000).map { run("row number \($0)", box(0.1, 1 - Double($0) * 0.0003, 0.2, 0.0002)) })
        t.expect(big.text.count <= 20_000 && big.truncated)
        t.expect(!big.text.hasSuffix("\n") && big.text.split(separator: "\n").last?.hasPrefix("row number") == true)
    }

    await t.test("the recognizer composes a fake observer's runs") {
        guard let png = renderedPNG(["x"], width: 64, height: 64, fontSize: 20) else {
            return t.expect(false, "render")
        }
        let recognizer = TextRecognizer(
            observer: FakeObserver(observations: [run("b", box(0.5, 0.5)), run("a", box(0.1, 0.5))]))
        for outcome in [await recognizer.recognize(png), await recognizer.recognize(base64: png.base64EncodedString())]
        {
            guard case .recognized(let text) = outcome else { return t.expect(false, "recognized") }
            t.expectEqual(text.text, "a b")
            t.expectEqual(text.confidence, 1)
            t.expect(!text.truncated)
            t.expectEqual(text.metrics?.boxes, 2)
        }
    }

    await t.test("typed failures: too large, unreadable, unavailable, observer error") {
        guard let small = renderedPNG(["x"], width: 64, height: 64, fontSize: 20),
            let wide = renderedPNG([], width: TextRecognizer.maxLongEdge + 1, height: 40)
        else { return t.expect(false, "render") }
        let recognizer = TextRecognizer(observer: FakeObserver())
        t.expectEqual(await recognizer.recognize(wide), .failed(.tooLarge))
        t.expectEqual(
            await recognizer.recognize(Data(repeating: 0, count: TextRecognizer.maxImageBytes + 1)), .failed(.tooLarge))
        t.expectEqual(
            await recognizer.recognize(base64: String(repeating: "A", count: TextRecognizer.maxBase64Characters + 4)),
            .failed(.tooLarge))
        t.expectEqual(await recognizer.recognize(Data("not an image".utf8)), .failed(.unreadable))
        t.expectEqual(await recognizer.recognize(base64: "***not base64***"), .failed(.unreadable))
        t.expectEqual(
            await TextRecognizer(observer: FakeObserver(isAvailable: false)).recognize(small), .failed(.unavailable))
        t.expectEqual(
            await TextRecognizer(observer: FakeObserver(failure: .unreadable)).recognize(small), .failed(.unreadable))
        t.expectEqual(
            await TextRecognizer(observer: FakeObserver(failure: .unavailable)).recognize(small), .failed(.unavailable))
    }

    await t.test("a slow observer times out, is cancelled, and the capture result simply omits ocr") {
        guard let png = renderedPNG(["x"], width: 64, height: 64, fontSize: 20) else {
            return t.expect(false, "render")
        }
        let started = ContinuousClock.now
        let outcome = await TextRecognizer(observer: FakeObserver(hangs: true)).recognize(
            png, within: .milliseconds(80))
        t.expectEqual(outcome, .failed(.timeout))
        t.expect(ContinuousClock.now - started < .seconds(5), "returns at the budget, not at the observer's pace")

        let frame = CaptureOutcome.image(jpeg: Data([1, 2, 3]), windowLabel: "window")
        var ocr: OcrText?
        if case .recognized(let text) = outcome { ocr = text }
        t.expect(
            HostReply.capture(frame, screenAccessGranted: true, ocr: ocr)["ocr"] == nil, "no ocr block after a timeout")
        let withText = HostReply.capture(
            frame, screenAccessGranted: true, ocr: OcrText(text: "hi", confidence: 0.5, truncated: false))
        t.expectEqual(withText["ok"] as? Bool, true)
        t.expectEqual(withText["mediaType"] as? String, "image/jpeg")
        let block = withText["ocr"] as? [String: Any]
        t.expectEqual(block?["engine"] as? String, "vision")
        t.expectEqual(block?["text"] as? String, "hi")
        t.expectEqual(block?["confidence"] as? Double, 0.5)
        t.expectEqual(block?["truncated"] as? Bool, false)
    }

    await t.test("the budget is a hard bound: an observer that ignores cancellation cannot hold the caller") {
        guard let png = renderedPNG(["x"], width: 64, height: 64, fontSize: 20) else {
            return t.expect(false, "render")
        }
        let started = ContinuousClock.now
        let outcome = await TextRecognizer(observer: StubbornObserver(delay: .seconds(3))).recognize(
            png, within: .milliseconds(100))
        t.expectEqual(outcome, .failed(.timeout), "the deadline wins; the late result is dropped")
        t.expect(ContinuousClock.now - started < .seconds(1), "returned at the budget, not when the observer finished")
        // A fast observer still wins the race.
        let fast = await TextRecognizer(observer: StubbornObserver(delay: .milliseconds(10))).recognize(
            png, within: .seconds(2))
        if case .recognized(let text) = fast {
            t.expectEqual(text.text, "late")
        } else {
            t.expect(false, "fast result lost: \(fast)")
        }
    }

    await t.test(
        "reply shapes: recognized carries ok, engine, text, confidence, truncated; a failure carries its reason"
    ) {
        let ok = HostReply.recognition(.recognized(OcrText(text: "a", confidence: 1, truncated: true)))
        t.expectEqual(
            Set(ok.keys), ["ok", "engine", "text", "confidence", "truncated"], "no metrics when not measured")
        let measured = OcrMetrics(coverage: 0.5, meanConfidence: 0.9, largestGap: 0.1, boxes: 3)
        let withMetrics = HostReply.recognition(
            .recognized(OcrText(text: "a", confidence: 1, truncated: false, metrics: measured)))
        t.expectEqual(Set(withMetrics.keys), ["ok", "engine", "text", "confidence", "truncated", "metrics"])
        let wire = withMetrics["metrics"] as? [String: Any]
        t.expectEqual(Set(wire?.keys.map { $0 } ?? []), ["coverage", "meanConfidence", "largestGap", "boxes"])
        t.expectEqual(wire?["boxes"] as? Int, 3)
        t.expectEqual(ok["ok"] as? Bool, true)
        for reason in [OcrFailure.tooLarge, .unreadable, .timeout, .unavailable] {
            let reply = HostReply.recognition(.failed(reason))
            t.expectEqual(reply["ok"] as? Bool, false)
            t.expectEqual(reply["reason"] as? String, reason.rawValue)
        }
        t.expectEqual(OcrFailure.tooLarge.rawValue, "too-large")
    }

    await t.test("an untrusted origin is not answered, even with a valid recognizeText message") {
        let message =
            ["v": 1, "method": "recognizeText", "params": ["mediaType": "image/png", "base64": "AAAA"]] as [String: Any]
        t.expect(HostCallDecoder.decode(message) != .failure(.invalidParameters), "the message itself is valid")
        let studio = StudioLocation(address: "http://127.0.0.1:3100", tenantSlug: "local")!
        func from(_ host: String, main: Bool = true) -> SenderFacts {
            SenderFacts(isMainFrame: main, scheme: "http", host: host, port: 3100, isIntendedWebView: true)
        }
        t.expect(BridgeTrust.accepts(from("127.0.0.1"), location: studio))
        t.expect(!BridgeTrust.accepts(from("evil.test"), location: studio), "another origin")
        t.expect(!BridgeTrust.accepts(from("127.0.0.1", main: false), location: studio), "a subframe")
    }

    await t.test("real Vision reads rendered text (skipped when Vision is unavailable)") {
        guard VisionTextObserver.available else { return print("skip: Vision text recognition is unavailable here") }
        guard let png = renderedPNG(["Quarterly Revenue 2048", "Invoice Total Paid"]) else {
            return t.expect(false, "render")
        }
        let outcome = await TextRecognizer(observer: VisionTextObserver()).recognize(png)
        guard case .recognized(let text) = outcome else { return t.expect(false, "expected text, got \(outcome)") }
        let lower = text.text.lowercased()
        for word in ["quarterly", "revenue", "2048", "invoice", "total"] {
            t.expect(lower.contains(word), "missing \(word) in recognised text")
        }
        t.expect(text.confidence > 0.3 && text.confidence <= 1)
    }

    // [TRACE] Grid math (32x32): a box is "covered cells it touches".
    await t.test("metrics: no boxes cover nothing and the whole frame is one gap") {
        let m = OcrMetrics.measure(boxes: [])
        t.expectEqual(m.coverage, 0)
        t.expectEqual(m.largestGap, 1)
        t.expectEqual(m.boxes, 0)
        t.expectEqual(m.meanConfidence, 0)
    }

    await t.test("metrics: a full-frame box covers everything with no gap") {
        let m = OcrMetrics.measure(boxes: [(CGRect(x: 0, y: 0, width: 1, height: 1), 0.8)])
        t.expectEqual(m.coverage, 1)
        t.expectEqual(m.largestGap, 0)
        t.expectEqual(m.meanConfidence, 0.8)
    }

    await t.test("metrics: a left half box covers half and leaves a half-frame gap") {
        let m = OcrMetrics.measure(boxes: [(CGRect(x: 0, y: 0, width: 0.5, height: 1), 1)])
        t.expectEqual(m.coverage, 0.5)
        t.expectEqual(m.largestGap, 0.5)
        t.expectEqual(m.boxes, 1)
    }

    await t.test("metrics: overlapping boxes count their union once; the gap is a rectangle") {
        let m = OcrMetrics.measure(boxes: [
            (CGRect(x: 0, y: 0.5, width: 0.5, height: 0.5), 1),
            (CGRect(x: 0.25, y: 0.5, width: 0.5, height: 0.5), 0.5),
        ])
        // Columns 0..<24 of rows 16..<32 covered: 24 * 16 = 384 of 1024.
        t.expectEqual(m.coverage, 0.375)
        t.expectEqual(m.meanConfidence, 0.75)
        // The bottom half (rows 0..<16, all columns) is the largest empty rectangle.
        t.expectEqual(m.largestGap, 0.5)
    }

    await t.test("metrics: a centred island leaves the L-shaped surround; the largest rectangle is a strip") {
        // Island covers columns 8..<24, rows 8..<24 (a 16x16 block = 256 cells).
        let m = OcrMetrics.measure(boxes: [(CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5), 1)])
        t.expectEqual(m.coverage, 0.25)
        // Full-width strips of 8 rows above or below: 32 * 8 = 256 cells.
        t.expectEqual(m.largestGap, 0.25)
    }

    await t.test("metrics: edges on a cell line stay out; boxes are clamped; bad boxes and confidences are bounded") {
        let exact = OcrMetrics.measure(boxes: [(CGRect(x: 0, y: 0, width: 1.0 / 32, height: 1.0 / 32), 1)])
        t.expectEqual(exact.coverage, 1.0 / 1024)
        let wild = OcrMetrics.measure(boxes: [
            (CGRect(x: -5, y: -5, width: 10, height: 10), 7),
            (CGRect(x: 0.1, y: 0.1, width: .nan, height: 0.1), 1),
            (CGRect(x: 0.1, y: 0.1, width: 0, height: 0.1), 1),
        ])
        t.expectEqual(wild.coverage, 1)
        t.expectEqual(wild.boxes, 1)
        t.expectEqual(wild.meanConfidence, 1)
    }

    await t.test("metrics: compose measures every box, including those beyond the character bound") {
        let rows = (0..<40).map { run("row \($0)", box(0.1, 1 - Double($0) * 0.02 - 0.02, 0.8, 0.015)) }
        let text = ReadingOrder.compose(rows, maxCharacters: 20)
        t.expect(text.truncated)
        t.expectEqual(text.metrics?.boxes, 40)
        t.expect((text.metrics?.coverage ?? 0) > 0.5)
    }
}
