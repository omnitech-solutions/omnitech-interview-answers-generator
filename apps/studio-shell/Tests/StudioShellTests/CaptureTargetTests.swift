import Foundation
import StudioShellCore

// The policy table: which application an EXPLICIT capture (button, hotkey,
// Add screenshot) or an AUTO capture may look at, given what is frontmost.
@MainActor
func captureTargetTests(_ t: Harness) async {
    let own: Int32 = 100
    let chrome: Int32 = 200
    let claude: Int32 = 300
    let safari: Int32 = 400
    let browsers: Set<Int32> = [chrome, safari]
    func decide(
        _ intent: CaptureIntent, front: Int32?, lastOther: Int32? = nil, lastBrowser: Int32? = nil
    ) -> Int32? {
        CaptureTargetPolicy.decide(
            intent: intent, frontmost: front, ownPid: own, lastOther: lastOther, lastBrowser: lastBrowser,
            isBrowser: { browsers.contains($0) })
    }

    await t.test("a browser in front is the target for both kinds of capture") {
        t.expectEqual(decide(.explicit, front: chrome), chrome)
        t.expectEqual(decide(.auto, front: chrome), chrome)
        t.expectEqual(
            decide(.explicit, front: safari, lastBrowser: chrome), safari, "the one in front, not the last other")
    }

    await t.test("explicit: another app in front falls back to the last focused browser") {
        t.expectEqual(decide(.explicit, front: claude, lastOther: claude, lastBrowser: chrome), chrome)
        t.expectEqual(
            decide(.explicit, front: own, lastOther: claude, lastBrowser: chrome), chrome, "the shell itself in front")
        t.expectEqual(decide(.explicit, front: nil, lastOther: claude, lastBrowser: chrome), chrome, "nothing in front")
    }

    await t.test("explicit: no browser focused since launch is no focused window, never widened") {
        t.expectEqual(decide(.explicit, front: claude, lastOther: claude, lastBrowser: nil), nil)
        t.expectEqual(decide(.explicit, front: own, lastOther: nil, lastBrowser: nil), nil)
        t.expectEqual(decide(.explicit, front: nil, lastBrowser: nil), nil)
        t.expectEqual(decide(.explicit, front: claude, lastBrowser: own), nil, "the shell is never a browser target")
    }

    await t.test("auto keeps 'only while a browser is in front': the last browser is not used") {
        t.expectEqual(decide(.auto, front: claude, lastOther: claude, lastBrowser: chrome), nil)
        t.expectEqual(decide(.auto, front: nil, lastOther: claude, lastBrowser: chrome), nil)
        t.expectEqual(decide(.auto, front: claude, lastBrowser: nil), nil)
    }

    await t.test("auto: the shell in front stands in the last other app, only when that is a browser") {
        t.expectEqual(decide(.auto, front: own, lastOther: chrome, lastBrowser: chrome), chrome)
        t.expectEqual(decide(.auto, front: own, lastOther: claude, lastBrowser: chrome), nil)
    }

    await t.test("the intent decodes from the wire; anything but 'explicit' is a refusal") {
        t.expectEqual(CaptureIntent(wire: nil), .auto, "absent is the safe default")
        t.expectEqual(CaptureIntent(wire: "explicit"), .explicit)
        t.expectEqual(CaptureIntent(wire: "auto"), .auto)
        t.expectEqual(CaptureIntent(wire: "everything"), nil)
    }

    await t.test("the front application is named by its name only, bounded") {
        t.expectEqual(FrontAppName.sanitize("Claude"), "Claude")
        t.expectEqual(FrontAppName.sanitize("  Claude \n"), "Claude")
        t.expectEqual(FrontAppName.sanitize(nil), nil)
        t.expectEqual(FrontAppName.sanitize("   "), nil)
        t.expectEqual(FrontAppName.sanitize(String(repeating: "a", count: 200))?.count, 64)
        t.expectEqual(FrontAppName.sanitize("Ab\u{0007}c\u{202E}d"), "Abcd", "control and bidi characters are dropped")
    }

    await t.test("a no-focused-window reply carries the front app name, other failures carry none") {
        let reply = HostReply.failure("no-focused-window", frontApp: "Claude")
        t.expectEqual(reply["ok"] as? Bool, false)
        t.expectEqual(reply["reason"] as? String, "no-focused-window")
        t.expectEqual(reply["frontApp"] as? String, "Claude")
        t.expect(HostReply.failure("no-focused-window", frontApp: nil)["frontApp"] == nil, "absent when unknown")
        t.expect(
            HostReply.failure("permission-denied", frontApp: "Claude")["frontApp"] == nil,
            "only no-focused-window names it")
        t.expectEqual(HostReply.failure("busy")["reason"] as? String, "busy")
    }

    await t.test("the intent key is accepted on captureScreen and carried to the handler") {
        let message: [String: Any] = [
            "v": 1, "method": "captureScreen", "params": ["mode": "display", "intent": "explicit"],
        ]
        if case .success(.captureScreen(_, _, let intent)) = HostCallDecoder.decode(message, requestId: "r") {
            t.expectEqual(intent, .explicit)
        } else {
            t.expect(false, "decodes")
        }
        let plain: [String: Any] = ["v": 1, "method": "captureScreen", "params": ["mode": "display"]]
        if case .success(.captureScreen(_, _, let intent)) = HostCallDecoder.decode(plain, requestId: "r") {
            t.expectEqual(intent, .auto)
        } else {
            t.expect(false, "decodes")
        }
        let bad: [String: Any] = ["v": 1, "method": "captureScreen", "params": ["mode": "display", "intent": "all"]]
        t.expectEqual(HostCallDecoder.decode(bad, requestId: "r"), .failure(.invalidParameters))
    }

    await t.test("openExternal allows the exact Screen Recording settings address and no other settings address") {
        let exact = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        let message: (String) -> [String: Any] = { ["v": 1, "method": "openExternal", "params": ["url": $0]] }
        t.expectEqual(
            HostCallDecoder.decode(message(exact), requestId: "r"), .success(.openExternal(URL(string: exact)!)))
        for other in [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
            "x-apple.systempreferences:com.apple.preference.security",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture&x=1",
            "X-APPLE.SYSTEMPREFERENCES:com.apple.preference.security?Privacy_ScreenCapture ",
            "x-apple.systempreferences:",
        ] {
            t.expectEqual(HostCallDecoder.decode(message(other), requestId: "r"), .failure(.invalidParameters), other)
        }
        t.expect(HostCallDecoder.externalURL(exact) == nil, "page navigation never opens settings")
    }
}
