import CaptureAdapters
import CaptureCore
import Foundation

// [SAFETY] Counts and rates only: the samples a tap delivers are never printed or kept.
private final class TapProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var frames = 0
    private var rates: Set<Int> = []
    private var sizes: Set<Int> = []
    private var sound = false
    private var ended = false
    func add(_ frame: AudioFrame) {
        lock.withLock {
            frames += 1
            rates.insert(frame.sampleRate)
            sizes.insert(frame.samples.count)
        }
    }
    func heard() { lock.withLock { sound = true } }
    func end() { lock.withLock { ended = true } }
    var frameCount: Int { lock.withLock { frames } }
    var shapes: (rates: Set<Int>, sizes: Set<Int>) { lock.withLock { (rates, sizes) } }
    var flags: (sound: Bool, ended: Bool) { lock.withLock { (sound, ended) } }
}

// OPT-IN, REAL HARDWARE. Runs only with PROCESS_TAP_HARDWARE=1:
//
//   PROCESS_TAP_HARDWARE=1 swift run studio-shell-tests
//
// It needs macOS 14.4 or later, a working audio output device, and the "System
// Audio Recording Only" permission for the program that runs it (the terminal;
// macOS asks the first time). It creates a real process tap for three seconds.
// Without that permission the tap still runs and delivers silence, so this
// test proves the tap, device and IOProc life cycle; play something during the
// three seconds to also see `sound=true`.
@MainActor
func processTapHardwareTests(_ t: Harness) async {
    guard ProcessInfo.processInfo.environment["PROCESS_TAP_HARDWARE"] == "1" else { return }
    await t.test("OPT-IN real hardware: a process tap delivers 16 kHz mono frames and tears down (macOS 14.4+)") {
        guard #available(macOS 14.4, *) else {
            t.expect(false, "needs macOS 14.4 or later: process taps do not exist on this macOS")
            return
        }
        let probe = TapProbe()
        let source = ProcessTapSource(
            onAudio: { probe.add($0) }, onSound: { probe.heard() }, onEnd: { _ in probe.end() })
        let failure = source.start()
        t.expect(
            failure == nil,
            "the tap did not start (\(failure?.rawValue ?? "-")): needs macOS 14.4+, an audio output device, "
                + "and System Audio Recording allowed for the terminal running this test")
        guard failure == nil else { return }
        try await Task.sleep(nanoseconds: 3_000_000_000)
        source.stop()
        let frames = probe.frameCount
        let shapes = probe.shapes
        let flags = probe.flags
        print(
            "process-tap hardware: frames=\(frames) rates=\(shapes.rates.sorted()) "
                + "sizes=\(shapes.sizes.sorted()) sound=\(flags.sound) endedByItself=\(flags.ended)")
        t.expect(
            frames >= 20,
            "only \(frames) frames in 3 s: the tap's device is not delivering (needs a working audio output)")
        t.expectEqual(shapes.rates, [TapFrameConverter.targetRate])
        t.expectEqual(shapes.sizes, [TapFrameConverter.frameSamples])
        t.expect(!flags.ended, "the tap ended by itself")
        // A second start and stop proves the first teardown left nothing behind.
        t.expect(source.start() == nil, "the tap did not start a second time after teardown")
        source.stop()
        let after = probe.frameCount
        try await Task.sleep(nanoseconds: 500_000_000)
        t.expectEqual(probe.frameCount, after, "frames arrived after stop")
    }
}
