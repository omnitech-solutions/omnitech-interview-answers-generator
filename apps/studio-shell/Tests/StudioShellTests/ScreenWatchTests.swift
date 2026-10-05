import CaptureCore
import Foundation
import JavaScriptCore
import StudioShellCore

@MainActor
private final class FakeSampler: ScreenWatchSampler {
    var queue: [ScreenWatchSample] = []
    var last: ScreenWatchSample = .noWindow
    var calls = 0
    func sample(_ request: ScreenWatchRequest) async -> ScreenWatchSample {
        calls += 1
        if !queue.isEmpty { last = queue.removeFirst() }
        return last
    }
}

private func grid(_ pattern: (Int) -> UInt8) -> [UInt8] { (0..<72).map(pattern) }
// Two visibly different pages: opposite brightness ramps per row.
private let pageA = grid { UInt8(($0 % 9) * 25) }
private let pageB = grid { UInt8(225 - ($0 % 9) * 25) }

@MainActor
func screenWatchTests(_ t: Harness) async {
    func hash(_ g: [UInt8]) -> UInt64 { PerceptualHash.difference(g)! }

    await t.test("detector: first frame baselines, a settled change emits once then rebaselines") {
        var d = ScreenChangeDetector()
        t.expect(d.observe(hash: hash(pageA), now: 0) == nil)
        t.expect(d.observe(hash: hash(pageB), now: 1) == nil, "changed but not yet stable")
        t.expect(d.observe(hash: hash(pageB), now: 3) == nil, "stable 2s only")
        t.expect(d.observe(hash: hash(pageB), now: 4.1) != nil, "stable 3s emits")
        t.expect(d.observe(hash: hash(pageB), now: 9) == nil, "rebaselined: no repeat")
        t.expect(d.observe(hash: hash(pageA), now: 10) == nil)
        t.expect(d.observe(hash: hash(pageA), now: 13.5) != nil, "next change emits again")
    }

    await t.test("detector: motion keeps resetting, small drift and returning to baseline emit nothing") {
        var d = ScreenChangeDetector()
        _ = d.observe(hash: hash(pageA), now: 0)
        // Alternating pages never hold still for 3 s.
        var emitted = 0
        for i in 1...20 where d.observe(hash: hash(i % 2 == 0 ? pageA : pageB), now: Double(i)) != nil { emitted += 1 }
        t.expectEqual(emitted, 0, "scrolling emits nothing")
        var small = pageA
        small[3] = small[3] &+ 2
        t.expect(d.observe(hash: hash(small), now: 30) == nil)
        t.expect(d.observe(hash: hash(small), now: 40) == nil, "under 12 bits is not a change")
        // A change that reverts before settling is cancelled.
        _ = d.observe(hash: hash(pageB), now: 41)
        _ = d.observe(hash: hash(pageA), now: 42)
        t.expect(d.observe(hash: hash(pageB), now: 46) == nil, "revert reset the stability clock")
    }

    await t.test("watcher: start probes, one event per settled change, stop pauses, permission loss ends") {
        let sampler = FakeSampler()
        var clock = 0.0
        let watcher = ScreenWatcher(sampler: sampler, now: { clock })
        var events: [Int] = []
        var statuses: [ScreenWatchStatus] = []
        watcher.onChange = { _, bits, _ in events.append(bits) }
        watcher.onStatus = { statuses.append($0) }

        sampler.last = .permissionDenied
        t.expect(await watcher.start(ScreenWatchRequest(mode: .focusedWindow), runLoop: false) == .permissionDenied)
        sampler.last = .noWindow
        t.expect(await watcher.start(ScreenWatchRequest(mode: .focusedWindow), runLoop: false) == .noFocusedWindow)
        sampler.last = .grid(pageA)
        t.expect(await watcher.start(ScreenWatchRequest(mode: .focusedWindow), runLoop: false) == nil)
        t.expect(watcher.status.watching)

        sampler.last = .grid(pageB)
        for second in 1...6 {
            clock = Double(second)
            await watcher.tick()
        }
        t.expectEqual(events.count, 1, "a new page emits exactly one event")
        sampler.last = .noWindow
        clock = 10
        await watcher.tick()
        t.expect(watcher.status.watching, "no window is transient")

        sampler.last = .permissionDenied
        await watcher.tick()
        t.expect(!watcher.status.watching)
        t.expectEqual(watcher.status.reason, "permission-denied")
        t.expect(statuses.last?.reason == "permission-denied")
        let before = sampler.calls
        await watcher.tick()
        t.expectEqual(sampler.calls, before, "ended watch samples nothing")

        sampler.last = .grid(pageA)
        _ = await watcher.start(ScreenWatchRequest(mode: .focusedWindow), runLoop: false)
        watcher.stop()
        t.expect(!watcher.status.watching && !watcher.isWatching)
    }

    await t.test("watcher: a moved display ends a region watch") {
        let sampler = FakeSampler()
        let watcher = ScreenWatcher(sampler: sampler, now: { 0 })
        sampler.last = .grid(pageA)
        let region = CaptureRegion(x: 0, y: 0, width: 0.5, height: 0.5)
        _ = await watcher.start(ScreenWatchRequest(mode: .region, region: region, displayId: 1), runLoop: false)
        sampler.last = .displayChanged
        await watcher.tick()
        t.expectEqual(watcher.status.reason, "display-changed")
    }

    await t.test("decoder: modes, regions, interval clamp, strict keys") {
        t.expectEqual(ScreenWatchDecoder.decodeStart(["mode": "focused-window"])?.intervalMs, 2000)
        t.expectEqual(ScreenWatchDecoder.decodeStart(["mode": "focused-window", "intervalMs": 100])?.intervalMs, 1000)
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "region"]) == nil, "region needs a region")
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "focused-window", "region": ["x": 0, "y": 0, "width": 1, "height": 1]]) == nil)
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "region", "region": ["x": 0.5, "y": 0, "width": 0.6, "height": 1]]) == nil)
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "region", "region": ["x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5], "displayId": 3]) != nil)
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "display"]) == nil)
        t.expect(ScreenWatchDecoder.decodeStart(["mode": "focused-window", "extra": 1]) == nil)
        switch HostCallDecoder.decode(["v": 1, "method": "screenWatchStart", "params": ["mode": "focused-window"]]) {
        case .success(.screenWatchStart): t.expect(true)
        default: t.expect(false, "start decodes")
        }
        t.expect(HostCallDecoder.decode(["v": 1, "method": "screenWatchStop", "params": [:]]) == .success(.screenWatchStop))
    }

    await t.test("page object: start/stop/status/onChange over the bridge script") {
        let context = JSContext()!
        context.evaluateScript("var window = this; var sent = [];")
        context.evaluateScript("""
            window.webkit = { messageHandlers: { studioHost: { postMessage: function (m) { sent.push(m.method); return { then: function (ok) { ok({ ok: true }); return { then: function () {} }; } }; } } } };
        """)
        context.evaluateScript(HostBridgeScript.source(capabilities: HostCapability.allCases))
        t.expectEqual(context.evaluateScript("typeof window.studioHost.screenWatch.start")?.toString(), "function")
        t.expectEqual(context.evaluateScript("window.studioHost.screenWatch.status().watching")?.toBool(), false)
        context.evaluateScript("var got = []; window.studioHost.screenWatch.onChange(function (e) { got.push(e.bits); });")
        context.evaluateScript(HostBridgeScript.emitScreenWatchChange(at: 5, bits: 20))
        t.expectEqual(context.evaluateScript("got.join(',')")?.toString(), "20")
        context.evaluateScript(HostBridgeScript.emitScreenWatchStatus(ScreenWatchStatus(watching: false, reason: "permission-denied")))
        t.expectEqual(context.evaluateScript("window.studioHost.screenWatch.status().reason")?.toString(), "permission-denied")
    }

    await t.test("window chrome: the intended configuration is see-through; each opaque trait is named") {
        t.expectEqual(PanelChrome.violations(.intended), [])
        var bad = PanelChromeSnapshot.intended
        bad.windowIsOpaque = true
        bad.webViewDrawsBackground = true
        bad.otherBackgroundAlphas = [1]
        t.expectEqual(PanelChrome.violations(bad).count, 3)
    }

    await t.test("soak: 500 repeated captures stay single-flight, prompt once, and fit small frames") {
        let gate = CaptureGate()
        var prompts = 0, completed = 0, overlaps = 0, running = 0
        for round in 0..<500 {
            // A second request arriving while one is in flight is refused.
            let first = Task { @MainActor in
                await gate.run {
                    running += 1
                    if running > 1 { overlaps += 1 }
                    if gate.shouldPromptForAccess(granted: round >= 250) { prompts += 1 }
                    await Task.yield()
                    running -= 1
                    return true
                }
            }
            await Task.yield()
            let second = await gate.run { true }
            t.expect(second == nil || !gate.inFlight, "second is refused while first runs")
            if await first.value != nil { completed += 1 }
        }
        t.expectEqual(overlaps, 0)
        t.expectEqual(prompts, 1, "denied for the first half, asked once")
        t.expect(completed == 500)
        t.expect(!gate.inFlight)
        let fit = FrameSize.fit(width: 5120, height: 2880)
        t.expect(max(fit.width, fit.height) == FrameSize.maxLongEdge, "Retina window is capped")
        t.expectEqual(FrameSize.fit(width: 800, height: 600).width, 800)
    }
}
