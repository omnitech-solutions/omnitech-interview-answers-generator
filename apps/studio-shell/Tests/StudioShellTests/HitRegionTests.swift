import CoreGraphics
import Foundation
import JavaScriptCore
import StudioShellCore

// See-through click-through by region: the wire decoder, the pure hit decision
// (screen point, regions, window frame) and the stale-report lease.

private func decode(_ regions: Any?) -> Result<HostCall, HostCallError> {
    var params: [String: Any] = ["op": "setHitRegions"]
    if let regions { params["regions"] = regions }
    return HostCallDecoder.decode(["v": 1, "method": "presentation", "params": params])
}

private func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> [String: Any] {
    ["x": x, "y": y, "width": w, "height": h]
}

// A window whose frame is 400x300 at (100, 200) on screen (Y up), no native strip.
private let frame = CGRect(x: 100, y: 200, width: 400, height: 300)
private let plain = HitGeometry(windowFrame: frame, topInset: 0)

@MainActor
func hitRegionTests(_ t: Harness) async {
    await t.test("setHitRegions decodes a bounded list, null, and an empty list; everything else is refused") {
        t.expectEqual(decode([rect(1, 2, 3, 4)]),
            .success(.presentation(.setHitRegions([HitRect(x: 1, y: 2, width: 3, height: 4)]))))
        t.expectEqual(decode(NSNull()), .success(.presentation(.setHitRegions(nil))), "null means no masking")
        t.expectEqual(decode([Any]()), .success(.presentation(.setHitRegions([]))), "empty means everything passes through")
        t.expectEqual(decode(nil), .failure(.invalidParameters), "the key is required")
        t.expectEqual(decode("all"), .failure(.invalidParameters))
        t.expectEqual(decode([rect(0, 0, 0, 10)]), .failure(.invalidParameters), "zero width")
        t.expectEqual(decode([rect(0, 0, 10, -1)]), .failure(.invalidParameters), "negative height")
        t.expectEqual(decode([rect(0, 0, 20001, 10)]), .failure(.invalidParameters), "over the side limit")
        t.expectEqual(decode([rect(0, 0, 20000, 20000)]), .success(.presentation(.setHitRegions([HitRect(x: 0, y: 0, width: 20000, height: 20000)]))), "the limit itself is fine")
        t.expectEqual(decode([rect(.infinity, 0, 10, 10)]), .failure(.invalidParameters), "infinite origin")
        t.expectEqual(decode([rect(.nan, 0, 10, 10)]), .failure(.invalidParameters), "NaN origin")
        t.expectEqual(decode([rect(30000, 0, 10, 10)]), .failure(.invalidParameters), "origin beyond the limit")
        t.expectEqual(decode([["x": 0, "y": 0, "width": 5]]), .failure(.invalidParameters), "missing key")
        t.expectEqual(decode([["x": 0, "y": 0, "width": 5, "height": 5, "z": 1]]), .failure(.invalidParameters), "extra key")
        t.expectEqual(decode([["x": true, "y": 0, "width": 5, "height": 5]]), .failure(.invalidParameters), "a Bool is not a number")
        t.expectEqual(decode([["x": "1", "y": 0, "width": 5, "height": 5]]), .failure(.invalidParameters), "a string is not a number")
        t.expectEqual(decode(Array(repeating: rect(0, 0, 1, 1), count: 64)).isSuccessCount(64), true, "64 rectangles are accepted")
        t.expectEqual(decode(Array(repeating: rect(0, 0, 1, 1), count: 65)), .failure(.invalidParameters), "65 are refused")
        // The operation takes exactly its own key.
        t.expectEqual(
            HostCallDecoder.decode(["v": 1, "method": "presentation", "params": ["op": "setHitRegions", "regions": NSNull(), "on": true]]),
            .failure(.invalidParameters))
    }

    await t.test("the hit-regions capability and page method match the contract") {
        let context = JSContext()!
        context.evaluateScript("""
        var window = this; var __posted = [];
        window.webkit = { messageHandlers: { studioHost: { postMessage: function (m) { __posted.push(JSON.stringify(m)); return Promise.resolve(true); } } } };
        """)
        context.evaluateScript(HostBridgeScript.source(capabilities: HostCapability.allCases))
        context.evaluateScript("""
        window.studioHost.presentation.setHitRegions([{ x: 1, y: 2, width: 3, height: 4 }]);
        window.studioHost.presentation.setHitRegions(null);
        """)
        t.expectEqual(context.evaluateScript("__posted[0]")?.toString(),
            #"{"v":1,"method":"presentation","params":{"op":"setHitRegions","regions":[{"x":1,"y":2,"width":3,"height":4}]}}"#)
        t.expectEqual(context.evaluateScript("__posted[1]")?.toString(),
            #"{"v":1,"method":"presentation","params":{"op":"setHitRegions","regions":null}}"#)
        t.expectEqual(context.evaluateScript("window.studioHost.presentation.capabilities.indexOf('hit-regions') >= 0")?.toBool(), true)
        // What the page sends is what the decoder accepts.
        t.expectEqual(decode(NSNull()), .success(.presentation(.setHitRegions(nil))))
    }

    await t.test("nil regions: everything is interactive, whatever the point") {
        t.expect(HitTest.isInteractive(at: CGPoint(x: 150, y: 250), in: plain, regions: nil))
        t.expect(HitTest.isInteractive(at: CGPoint(x: 5000, y: 5000), in: plain, regions: nil), "even off the window")
        t.expect(!HitTest.ignoresMouse(at: CGPoint(x: 150, y: 250), in: plain, regions: nil))
    }

    await t.test("an empty list: everything passes through") {
        for point in [CGPoint(x: 100, y: 500), CGPoint(x: 300, y: 350), CGPoint(x: 499, y: 201)] {
            t.expect(HitTest.ignoresMouse(at: point, in: plain, regions: []), "\(point)")
        }
    }

    await t.test("inside a rectangle the window takes the mouse; outside it passes through") {
        // Page rect: 50..150 across, 10..40 down from the window's top-left.
        let regions = [HitRect(x: 50, y: 10, width: 100, height: 30)]
        // The window's top is y = 500; page y = 500 - screen y (flipped).
        t.expect(HitTest.isInteractive(at: CGPoint(x: 100 + 100, y: 500 - 25), in: plain, regions: regions), "inside")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 100 + 100, y: 500 - 60), in: plain, regions: regions), "below it on the page")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 100 + 10, y: 500 - 25), in: plain, regions: regions), "left of it")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 100 + 200, y: 500 - 5), in: plain, regions: regions), "above it")
        // Two rectangles: either one counts.
        let two = regions + [HitRect(x: 0, y: 250, width: 400, height: 50)]
        t.expect(HitTest.isInteractive(at: CGPoint(x: 120, y: 205), in: plain, regions: two), "the footer-like one at the bottom")
    }

    await t.test("Y is flipped: page y grows downward from the window's top edge") {
        // A rect hugging the page's top-left corner is at the TOP-left of the window on screen.
        let top = [HitRect(x: 0, y: 0, width: 40, height: 20)]
        t.expect(HitTest.isInteractive(at: CGPoint(x: 110, y: 490), in: plain, regions: top), "top-left of the window")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 110, y: 210), in: plain, regions: top), "bottom-left is not")
        let point = plain.pagePoint(CGPoint(x: 110, y: 490))
        t.expectEqual(point, CGPoint(x: 10, y: 10))
    }

    await t.test("edges count as inside; one point past them does not") {
        let regions = [HitRect(x: 50, y: 10, width: 100, height: 30)]
        // Left edge x = 150 on screen, top edge page y 10 => screen y 490.
        t.expect(HitTest.isInteractive(at: CGPoint(x: 150, y: 490 - 10), in: plain, regions: regions), "top-left corner")
        t.expect(HitTest.isInteractive(at: CGPoint(x: 250, y: 500 - 40), in: plain, regions: regions), "bottom edge")
        t.expect(HitTest.isInteractive(at: CGPoint(x: 250, y: 500 - 10), in: plain, regions: regions), "top edge")
        t.expect(HitTest.isInteractive(at: CGPoint(x: 100 + 150, y: 500 - 25), in: plain, regions: regions), "right edge")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 100 + 150.5, y: 500 - 25), in: plain, regions: regions), "just right of it")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 100 + 49.5, y: 500 - 25), in: plain, regions: regions), "just left of it")
    }

    await t.test("rectangles are clamped to the page: a surface hanging off the window counts only where it is on it") {
        let size = CGSize(width: 400, height: 300)
        t.expectEqual(HitTest.clamped([HitRect(x: -20, y: -10, width: 60, height: 40)], to: size),
            [HitRect(x: 0, y: 0, width: 40, height: 30)])
        t.expectEqual(HitTest.clamped([HitRect(x: 380, y: 280, width: 100, height: 100)], to: size),
            [HitRect(x: 380, y: 280, width: 20, height: 20)])
        t.expectEqual(HitTest.clamped([HitRect(x: 500, y: 0, width: 10, height: 10)], to: size), [], "wholly outside is dropped")
        t.expectEqual(HitTest.clamped([HitRect(x: -50, y: 0, width: 50, height: 10)], to: size), [], "touching only the outside edge is dropped")
        // A point outside the window is never interactive when a mask is set, even in a huge rectangle.
        let huge = [HitRect(x: -1000, y: -1000, width: 5000, height: 5000)]
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 10, y: 10), in: plain, regions: huge), "off the window")
        t.expect(HitTest.isInteractive(at: CGPoint(x: 300, y: 300), in: plain, regions: huge), "on the window")
    }

    await t.test("the native strip over the page stays interactive, and the page's origin sits below it") {
        let withStrip = HitGeometry(windowFrame: frame, topInset: 16)
        // Page y = (500 - 16) - screen y. The strip is screen y 484..500.
        t.expect(HitTest.isInteractive(at: CGPoint(x: 300, y: 495), in: withStrip, regions: []), "the strip drags the window even with nothing reported")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 300, y: 480), in: withStrip, regions: []), "below the strip, nothing reported passes through")
        let top = [HitRect(x: 0, y: 0, width: 400, height: 40)]
        t.expect(HitTest.isInteractive(at: CGPoint(x: 300, y: 484 - 39), in: withStrip, regions: top), "the toolbar row just under the strip")
        t.expect(!HitTest.isInteractive(at: CGPoint(x: 300, y: 484 - 41), in: withStrip, regions: top), "just below the toolbar")
        t.expectEqual(withStrip.pageSize, CGSize(width: 400, height: 284))
    }

    await t.test("a report goes stale: after the timeout the window is interactive again; a fresh one restores the mask") {
        var lease = HitRegionLease()
        let inside = CGPoint(x: 300, y: 300)
        t.expect(!lease.ignoresMouse(at: inside, in: plain, now: 0), "nothing reported: interactive")
        lease.update([], now: 100)
        t.expect(lease.ignoresMouse(at: inside, in: plain, now: 100), "an empty report masks everything")
        t.expect(lease.ignoresMouse(at: inside, in: plain, now: 100 + HitRegions.staleAfter), "still fresh at the limit")
        t.expect(!lease.ignoresMouse(at: inside, in: plain, now: 100 + HitRegions.staleAfter + 0.1), "stale: interactive")
        t.expect(lease.current(now: 200) == nil)
        lease.update([], now: 200)
        t.expect(lease.ignoresMouse(at: inside, in: plain, now: 201), "a new report restores the mask")
        lease.update(nil, now: 202)
        t.expect(!lease.ignoresMouse(at: inside, in: plain, now: 202), "null takes the mask off at once")
        t.expectEqual(HitRegions.staleAfter, 15)
    }
}

private extension Result where Success == HostCall, Failure == HostCallError {
    func isSuccessCount(_ count: Int) -> Bool {
        if case .success(.presentation(.setHitRegions(let rects))) = self { return rects?.count == count }
        return false
    }
}
