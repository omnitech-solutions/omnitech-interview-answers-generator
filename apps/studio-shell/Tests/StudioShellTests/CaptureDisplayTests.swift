import CaptureCore
import CoreGraphics
import Foundation
import JavaScriptCore
import StudioShellCore

private final class MemoryStore: SettingsStore {
    var values: [String: String] = [:]
    func string(forKey key: String) -> String? { values[key] }
    func set(_ value: String?, forKey key: String) { values[key] = value }
}

private let own: Int32 = 100
private let chrome: Int32 = 200
// Two side-by-side displays in global coordinates (the second to the right of the first).
private let left = DisplayFrame(id: 1, frame: CGRect(x: 0, y: 0, width: 1440, height: 900))
private let right = DisplayFrame(id: 2, frame: CGRect(x: 1440, y: 0, width: 2560, height: 1440))

private func win(
    _ id: UInt32, pid: Int32 = chrome, layer: Int = 0, x: Double, y: Double = 100, w: Double = 800, h: Double = 600
) -> PlacedWindow {
    PlacedWindow(windowId: id, ownerPid: pid, layer: layer, frame: CGRect(x: x, y: y, width: w, height: h))
}

@MainActor
func captureDisplayTests(_ t: Harness) async {
    await t.test("window choice: the FRONTMOST qualifying window of the sampled app, never the shell or another app") {
        let ordered = [
            win(1, pid: own, x: 0, w: 2000, h: 2000),  // the shell's own, in front
            win(2, pid: 300, x: 0),  // another app in front of Chrome
            win(3, layer: 25, x: 0),  // a Chrome overlay
            win(4, x: 0, w: 40, h: 40),  // a Chrome tooltip-sized window
            win(5, x: 1500),  // frontmost real Chrome window
            win(6, x: 100, w: 2000, h: 1500),  // a larger Chrome window behind it
        ]
        t.expectEqual(
            CaptureTarget.frontmostWindow(sampledPid: chrome, ownPid: own, ordered: ordered)?.windowId, 5,
            "frontmost, not largest")
        t.expectEqual(
            CaptureTarget.frontmostWindow(sampledPid: own, ownPid: own, ordered: ordered)?.windowId, nil,
            "never the shell")
        t.expectEqual(CaptureTarget.frontmostWindow(sampledPid: nil, ownPid: own, ordered: ordered)?.windowId, nil)
        t.expectEqual(
            CaptureTarget.frontmostWindow(sampledPid: 999, ownPid: own, ordered: ordered)?.windowId, nil,
            "no widening to another app")
        t.expectEqual(
            CaptureTarget.frontmostWindow(sampledPid: chrome, ownPid: own, ordered: ordered, on: left)?.windowId, 6,
            "pinned display: the frontmost window centred on it")
        t.expectEqual(
            CaptureTarget.frontmostWindow(sampledPid: chrome, ownPid: own, ordered: [win(5, x: 1500)], on: left)?
                .windowId, nil, "pinned display with no window: nothing")
    }

    await t.test("display resolution: the display holding the centre of the frontmost window, else the fallback") {
        let displays = [left, right]
        func resolve(_ ordered: [PlacedWindow], pid: Int32? = chrome) -> UInt32 {
            CaptureTarget.display(sampledPid: pid, ownPid: own, ordered: ordered, displays: displays, fallback: 1)
        }
        t.expectEqual(resolve([win(5, x: 1500)]), 2, "Chrome is on the second display")
        t.expectEqual(resolve([win(5, x: 1500), win(6, x: 0)]), 2, "the frontmost one decides")
        t.expectEqual(resolve([win(6, x: 0), win(5, x: 1500)]), 1)
        // Straddling windows follow the centre: centre x = 1100 + 400 = 1500 -> right.
        t.expectEqual(resolve([win(7, x: 1100)]), 2, "centre, not top-left")
        t.expectEqual(resolve([win(8, x: 0, w: 30, h: 30)]), 1, "too small: fallback")
        t.expectEqual(resolve([win(5, x: 1500)], pid: own), 1, "the shell is never the sampled app: fallback")
        t.expectEqual(resolve([], pid: chrome), 1, "no window: fallback")
        t.expectEqual(resolve([win(9, x: 9000)]), 1, "centre on no display: fallback")
    }

    await t.test(
        "display and region captures render ONLY the browser's windows: a non-browser in front is never included"
    ) {
        let slack: Int32 = 300
        // Slack and the shell are in front of Chrome on the same display; Chrome has a window and a tiny tooltip.
        let ordered = [
            win(1, pid: own, x: 0, w: 2000, h: 2000), win(2, pid: slack, x: 0, w: 1000, h: 800),
            win(3, x: 100), win(4, x: 100, w: 20, h: 20), win(5, layer: 25, x: 0), win(6, x: 1500),
        ]
        t.expectEqual(
            CaptureTarget.browserWindowIds(sampledPid: chrome, ownPid: own, ordered: ordered), [3, 6],
            "only Chrome's document windows: not Slack, not the shell, not a tooltip or a menu-layer window")
        t.expect(
            CaptureTarget.browserWindowIds(sampledPid: nil, ownPid: own, ordered: ordered).isEmpty, "no sampled app")
        t.expect(
            CaptureTarget.browserWindowIds(sampledPid: own, ownPid: own, ordered: ordered).isEmpty, "never the shell")
        // The pinned display holds only Slack's windows: the browser is not on it, so there is no target.
        t.expect(
            CaptureTarget.browserWindowIds(
                sampledPid: chrome, ownPid: own, ordered: [win(2, pid: slack, x: 1500), win(3, x: 100)], on: right
            ).isEmpty,
            "no browser window on the pinned display")
        t.expectEqual(
            CaptureTarget.browserWindowIds(
                sampledPid: chrome, ownPid: own, ordered: [win(3, x: 100), win(6, x: 1500)], on: right), [3, 6],
            "a browser window on the pinned display makes the browser eligible")
    }

    await t.test(
        "a hidden, minimised or other-Space browser has no on-screen window: no target, never the main display"
    ) {
        // The window server lists on-screen windows only: Chrome's are absent, Slack's are all there is.
        let onScreen = [win(2, pid: 300, x: 0, w: 1000, h: 800), win(1, pid: own, x: 0, w: 2000, h: 2000)]
        t.expect(
            CaptureTarget.browserWindowIds(sampledPid: chrome, ownPid: own, ordered: onScreen).isEmpty,
            "empty: the capture answers no-focused-window instead of capturing a display with no browser")
        // The old fallback still names a display, which is exactly why the id list gates the capture.
        t.expectEqual(
            CaptureTarget.display(
                sampledPid: chrome, ownPid: own, ordered: onScreen, displays: [left, right], fallback: 1), 1)
    }

    await t.test("display info: names drop control, bidi and line-separator characters and are bounded by scalars") {
        let hostile = "Mon\u{202E}itor\u{2028}X\u{0007}\u{200B}"
        t.expectEqual(DisplayInfo.list(ids: [1], names: [1: hostile])[0].name, "MonitorX")
        let cluster = "e" + String(repeating: "\u{0301}", count: 500)
        t.expectEqual(
            DisplayInfo.list(ids: [1], names: [1: cluster])[0].name.unicodeScalars.count, DisplayInfo.maxNameLength,
            "a 501-scalar grapheme cluster is cut at 64 scalars")
        t.expectEqual(
            DisplayInfo.list(ids: [1], names: [1: "\u{202E}\u{2029}"])[0].name, "Display",
            "nothing left: the default name")
    }

    await t.test("display info: 1-based index in screen order, count, named by the system, bounded") {
        let list = DisplayInfo.list(ids: [7, 3, 9], names: [7: "Built-in Retina Display", 3: "DELL U2723QE", 9: "  "])
        t.expectEqual(list.map(\.index), [1, 2, 3])
        t.expectEqual(list.map(\.count), [3, 3, 3])
        t.expectEqual(list.map(\.name), ["Built-in Retina Display", "DELL U2723QE", "Display"])
        t.expectEqual(
            DisplayInfo.list(ids: [1], names: [1: String(repeating: "x", count: 200)])[0].name.count,
            DisplayInfo.maxNameLength)
        let wire = list[1].wire
        t.expectEqual(Set(wire.keys), ["id", "name", "index", "count"], "a closed object: no titles, no urls")
        t.expectEqual(wire["id"] as? Int, 3)
    }

    await t.test("pin: persists, drops to follow when its display disappears and says so once") {
        let store = MemoryStore()
        let pin = DisplayPin(prefs: ShellPrefs(store: store))
        t.expectEqual(pin.effective(available: [1, 2]), nil, "follow by default")
        t.expect(!pin.set(5, available: [1, 2]), "an unknown display cannot be pinned")
        t.expectEqual(pin.pinnedId, nil)
        t.expect(pin.set(2, available: [1, 2]))
        t.expectEqual(DisplayPin(prefs: ShellPrefs(store: store)).pinnedId, 2, "remembered across launches")
        t.expectEqual(pin.effective(available: [1, 2]), 2)
        t.expectEqual(pin.takeFallback(), nil)
        t.expectEqual(pin.effective(available: [1]), nil, "display gone: follow")
        t.expectEqual(pin.pinnedId, nil, "the stale pin is forgotten, not remapped")
        t.expectEqual(pin.takeFallback(), .displayUnavailable, "reported")
        t.expectEqual(pin.takeFallback(), nil, "reported once")
        t.expect(pin.set(1, available: [1]))
        t.expect(pin.set(nil, available: [1]))
        t.expectEqual(pin.pinnedId, nil, "null returns to follow")
    }

    await t.test("pin snapshot: valid pin, gone pin (null + one-time fallback), no pin") {
        let store = MemoryStore()
        let pin = DisplayPin(prefs: ShellPrefs(store: store))
        let none = pin.snapshot(available: [1, 2])
        t.expectEqual(none.id, nil, "no pin")
        t.expectEqual(none.fallback, nil)
        t.expect(pin.set(2, available: [1, 2]))
        let valid = DisplayPin(prefs: ShellPrefs(store: store)).snapshot(available: [1, 2])
        t.expectEqual(valid.id, 2, "a remembered pin that is still present")
        t.expectEqual(valid.fallback, nil)
        let gone = pin.snapshot(available: [1])
        t.expectEqual(gone.id, nil, "its display is gone: cleared")
        t.expectEqual(gone.fallback, .displayUnavailable, "reported")
        t.expectEqual(pin.pinnedId, nil, "the stale pin is forgotten")
        let again = pin.snapshot(available: [1])
        t.expectEqual(again.id, nil)
        t.expectEqual(again.fallback, nil, "reported once")
    }

    await t.test(
        "bridge decode: listDisplays takes only an optional boolean thumbnails; setCaptureDisplay takes exactly displayId (uint32 or null)"
    ) {
        func decode(_ method: String, _ params: [String: Any]) -> Result<HostCall, HostCallError> {
            HostCallDecoder.decode(["v": 1, "method": method, "params": params])
        }
        t.expect(decode("listDisplays", [:]) == .success(.listDisplays(thumbnails: true)))
        t.expect(decode("listDisplays", ["thumbnails": false]) == .success(.listDisplays(thumbnails: false)))
        t.expect(decode("listDisplays", ["thumbnails": true]) == .success(.listDisplays(thumbnails: true)))
        t.expect(decode("listDisplays", ["thumbnails": 0]) == .failure(.invalidParameters), "a real boolean only")
        t.expect(decode("listDisplays", ["thumbnails": "no"]) == .failure(.invalidParameters))
        t.expect(decode("listDisplays", ["x": 1]) == .failure(.invalidParameters))
        t.expect(decode("setCaptureDisplay", ["displayId": 3]) == .success(.setCaptureDisplay(3)))
        t.expect(decode("setCaptureDisplay", ["displayId": NSNull()]) == .success(.setCaptureDisplay(nil)))
        t.expect(decode("setCaptureDisplay", [:]) == .failure(.invalidParameters), "the key is required")
        t.expect(decode("setCaptureDisplay", ["displayId": -1]) == .failure(.invalidParameters))
        t.expect(decode("setCaptureDisplay", ["displayId": 1.5]) == .failure(.invalidParameters))
        t.expect(decode("setCaptureDisplay", ["displayId": "2"]) == .failure(.invalidParameters))
        t.expect(decode("setCaptureDisplay", ["displayId": true]) == .failure(.invalidParameters))
        t.expect(decode("setCaptureDisplay", ["displayId": 2, "extra": 1]) == .failure(.invalidParameters))
    }

    await t.test(
        "replies: capture carries display, pinned and a one-off pinFallback; lists and pins are closed objects"
    ) {
        let info = DisplayInfo(id: 2, name: "DELL", index: 2, count: 3)
        let image = CaptureOutcome.image(jpeg: Data([1, 2, 3]), windowLabel: "Chrome")
        let reply = HostReply.capture(
            image, screenAccessGranted: true, displayId: 2, display: info, pinned: true,
            pinFallback: .displayUnavailable)
        t.expectEqual((reply["display"] as? [String: Any])?["name"] as? String, "DELL")
        t.expectEqual(reply["pinned"] as? Bool, true)
        t.expectEqual(reply["pinFallback"] as? String, "display-unavailable")
        t.expectEqual(HostReply.capture(image, screenAccessGranted: true)["pinned"] as? Bool, false)
        t.expect(HostReply.capture(image, screenAccessGranted: true)["pinFallback"] == nil)
        t.expect(
            HostReply.capture(.lost(.captureFailed), screenAccessGranted: true, display: info)["display"] == nil,
            "a failure names no display")
        let list = HostReply.displayList([(info, Data([9]))])
        let first = (list["displays"] as? [[String: Any]])?.first
        t.expectEqual(Set(first?.keys.map { $0 } ?? []), ["display", "thumbnail"])
        t.expectEqual((first?["thumbnail"] as? [String: Any])?["mediaType"] as? String, "image/jpeg")
        t.expectEqual(list["pinnedDisplayId"] is NSNull, true, "no pin: null, always present")
        t.expect(list["pinFallback"] == nil)
        let pinnedList = HostReply.displayList([], pinnedDisplayId: 2, pinFallback: nil)
        t.expectEqual(pinnedList["pinnedDisplayId"] as? Int, 2)
        t.expectEqual((pinnedList["displays"] as? [Any])?.count, 0)
        let droppedList = HostReply.displayList([], pinnedDisplayId: nil, pinFallback: .displayUnavailable)
        t.expectEqual(droppedList["pinnedDisplayId"] is NSNull, true)
        t.expectEqual(droppedList["pinFallback"] as? String, "display-unavailable")
        t.expectEqual(HostReply.captureDisplaySet(nil)["pinned"] as? Bool, false)
        t.expect(HostReply.captureDisplaySet(nil)["display"] == nil)
        t.expectEqual(HostReply.captureDisplaySet(info)["pinned"] as? Bool, true)
    }

    await t.test("watch change event carries the display (and none when unknown); page object has the two ops") {
        let context = JSContext()!
        context.evaluateScript("var window = this; var sent = [];")
        context.evaluateScript(
            """
                window.webkit = { messageHandlers: { studioHost: { postMessage: function (m) { sent.push(JSON.stringify(m)); return { then: function (ok) { ok({ ok: true }); return { then: function () {} }; } }; } } } };
            """)
        context.evaluateScript(HostBridgeScript.source(capabilities: HostCapability.allCases))
        context.evaluateScript("var got = []; window.studioHost.screenWatch.onChange(function (e) { got.push(e); });")
        let info = DisplayInfo(id: 2, name: "DELL", index: 2, count: 3)
        context.evaluateScript(HostBridgeScript.emitScreenWatchChange(at: 5, bits: 20, display: info))
        context.evaluateScript(HostBridgeScript.emitScreenWatchChange(at: 6, bits: 21))
        t.expectEqual(
            context.evaluateScript("got[0].display.name + got[0].display.index + got[0].display.count")?.toString(),
            "DELL23")
        t.expectEqual(context.evaluateScript("got[1].display === undefined")?.toBool(), true)
        context.evaluateScript(
            "window.studioHost.listDisplays(); window.studioHost.setCaptureDisplay(3); window.studioHost.setCaptureDisplay(null); window.studioHost.listDisplays({ thumbnails: false }); window.studioHost.listDisplays({ thumbnails: 1, x: 2 });"
        )
        t.expectEqual(
            context.evaluateScript("sent.join('|')")?.toString(),
            "{\"v\":1,\"method\":\"listDisplays\",\"params\":{}}|{\"v\":1,\"method\":\"setCaptureDisplay\",\"params\":{\"displayId\":3}}|{\"v\":1,\"method\":\"setCaptureDisplay\",\"params\":{\"displayId\":null}}|{\"v\":1,\"method\":\"listDisplays\",\"params\":{\"thumbnails\":false}}|{\"v\":1,\"method\":\"listDisplays\",\"params\":{}}"
        )
    }
}
