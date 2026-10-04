import CaptureCore
import Foundation
import StudioShellCore

private func call(_ method: String, _ params: [String: Any] = [:], v: Any = 1) -> Result<HostCall, HostCallError> {
    HostCallDecoder.decode(["v": v, "method": method, "params": params] as [String: Any], requestId: "r")
}

@MainActor
func bridgeDecodeTests(_ t: Harness) async {
    await t.test("captureScreen decodes each mode; a region is exact") {
        t.expectEqual(call("captureScreen", ["mode": "focused-window"]),
            .success(.captureScreen(CaptureRequest(requestId: "r", mode: .focusedWindow))))
        t.expectEqual(call("captureScreen", ["mode": "display"]),
            .success(.captureScreen(CaptureRequest(requestId: "r", mode: .display))))
        let region: [String: Any] = ["x": 0.1, "y": 0.2, "width": 0.5, "height": 0.4]
        t.expectEqual(call("captureScreen", ["mode": "region", "region": region]),
            .success(.captureScreen(CaptureRequest(
                requestId: "r", mode: .region, region: CaptureRegion(x: 0.1, y: 0.2, width: 0.5, height: 0.4)))))
    }

    await t.test("a region outside the unit square, empty, missing or unexpected is refused") {
        func region(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> Result<HostCall, HostCallError> {
            call("captureScreen", ["mode": "region", "region": ["x": x, "y": y, "width": w, "height": h]])
        }
        for bad in [region(0.8, 0, 0.5, 0.5), region(0, 0.9, 0.5, 0.2), region(-0.1, 0, 0.5, 0.5),
            region(0, 0, 0, 0.5), region(0, 0, 0.5, 0), region(.nan, 0, 0.5, 0.5), region(0, 0, .infinity, 0.5)]
        {
            t.expectEqual(bad, .failure(.invalidParameters))
        }
        t.expectEqual(call("captureScreen", ["mode": "region"]), .failure(.invalidParameters))
        t.expectEqual(
            call("captureScreen", ["mode": "display", "region": ["x": 0, "y": 0, "width": 1, "height": 1]]),
            .failure(.invalidParameters))
        t.expectEqual(call("captureScreen", ["mode": "everything"]), .failure(.invalidParameters))
        t.expectEqual(call("captureScreen", ["mode": "region", "region": ["x": true, "y": 0, "width": 1, "height": 1]]),
            .failure(.invalidParameters), "a Bool is not a number")
    }

    await t.test("pinOnTop and openExternal are bounded") {
        t.expectEqual(call("pinOnTop", ["pinned": true]), .success(.pinOnTop(true)))
        t.expectEqual(call("pinOnTop", ["pinned": "yes"]), .failure(.invalidParameters))
        t.expectEqual(call("openExternal", ["url": "https://example.com/a"]),
            .success(.openExternal(URL(string: "https://example.com/a")!)))
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "https://u:p@example.com", "https://", "example.com", ""] {
            t.expectEqual(call("openExternal", ["url": bad]), .failure(.invalidParameters), bad)
        }
    }

    await t.test("an unknown version, method or body shape is refused") {
        t.expectEqual(call("captureScreen", ["mode": "display"], v: 2), .failure(.unsupportedVersion))
        t.expectEqual(call("captureScreen", ["mode": "display"], v: "1"), .failure(.unsupportedVersion))
        t.expectEqual(call("launchMissiles"), .failure(.unknownMethod))
        t.expectEqual(HostCallDecoder.decode("hello"), .failure(.malformed))
        t.expectEqual(HostCallDecoder.decode(["v": 1] as [String: Any]), .failure(.malformed))
    }

    await t.test("a capture reply carries the image, or the reason; never a title") {
        let ok = HostReply.capture(.image(jpeg: Data([0xff, 0xd8, 0xff, 0xd9]), windowLabel: "Secret App"), screenAccessGranted: true)
        t.expectEqual(ok["ok"] as? Bool, true)
        t.expectEqual(ok["base64"] as? String, "/9j/2Q==")
        t.expect(!"\(ok)".contains("Secret App"), "the application name is not sent")
        t.expectEqual(HostReply.capture(.lost(.noFocusedWindow), screenAccessGranted: true)["reason"] as? String, "no-focused-window")
        t.expectEqual(HostReply.capture(.lost(.captureFailed), screenAccessGranted: true)["reason"] as? String, "capture-failed")
        t.expectEqual(HostReply.capture(.lost(.captureFailed), screenAccessGranted: false)["reason"] as? String, "permission-denied")
    }
}
