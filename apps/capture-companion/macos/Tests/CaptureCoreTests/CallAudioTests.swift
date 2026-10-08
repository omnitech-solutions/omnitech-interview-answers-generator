import CaptureCore
import Foundation

// The call-audio setting's rules and the tap's frame conversion, with synthetic
// buffers only: no audio hardware, no permission.

private func push(_ converter: inout TapFrameConverter, interleaved samples: [Float], channels: Int) -> [AudioFrame] {
    samples.withUnsafeBufferPointer { converter.push(interleaved: $0, channels: channels) }
}

private func sine(hz: Double, rate: Double, count: Int) -> [Float] {
    (0..<count).map { Float(sin(2 * Double.pi * hz * Double($0) / rate)) }
}

private func peak(_ frames: [AudioFrame]) -> Float {
    frames.flatMap(\.samples).map(abs).max() ?? 0
}

@MainActor
func callAudioTests(_ t: Harness) async {
    await t.test("the call-audio setting defaults to ScreenCaptureKit and refuses unknown values") {
        t.expectEqual(CallAudioSource.default, .screenCaptureKit)
        t.expectEqual(CallAudioSource.parse(nil), .screenCaptureKit)
        t.expectEqual(CallAudioSource.parse(""), .screenCaptureKit)
        t.expectEqual(CallAudioSource.parse("ProcessTap"), .screenCaptureKit)
        t.expectEqual(CallAudioSource.parse("processTap "), .screenCaptureKit)
        t.expectEqual(CallAudioSource.parse("processTap"), .processTap)
        t.expectEqual(CallAudioSource.parse("screenCaptureKit"), .screenCaptureKit)
        t.expectEqual(CallAudioSource.allCases.map(\.rawValue), ["screenCaptureKit", "processTap"])
    }

    await t.test("process taps are supported from macOS 14.4") {
        t.expect(!CallAudioSource.tapSupported(osMajor: 13, osMinor: 6))
        t.expect(!CallAudioSource.tapSupported(osMajor: 14, osMinor: 3))
        t.expect(CallAudioSource.tapSupported(osMajor: 14, osMinor: 4))
        t.expect(CallAudioSource.tapSupported(osMajor: 15, osMinor: 0))
        t.expect(CallAudioSource.tapSupported(osMajor: 26, osMinor: 0))
    }

    await t.test("ScreenCaptureKit is attempted unless the tap is chosen, supported and not failed") {
        func attempt(_ preference: CallAudioSource, _ minor: Int, _ evidence: TapEvidence) -> String {
            let plan = CallAudioPlan.attempt(preference: preference, osMajor: 14, osMinor: minor, evidence: evidence)
            return "\(plan.source.rawValue)/\(plan.reason?.rawValue ?? "-")"
        }
        // The default never names a reason and never looks at the tap.
        t.expectEqual(attempt(.screenCaptureKit, 6, .untried), "screenCaptureKit/-")
        t.expectEqual(attempt(.screenCaptureKit, 6, .heardSound), "screenCaptureKit/-")
        t.expectEqual(attempt(.screenCaptureKit, 0, .failed(.noBuffers)), "screenCaptureKit/-")
        t.expectEqual(attempt(.processTap, 3, .untried), "screenCaptureKit/os-too-old")
        t.expectEqual(attempt(.processTap, 4, .untried), "processTap/-")
        t.expectEqual(attempt(.processTap, 4, .runningSilent), "processTap/-")
        t.expectEqual(attempt(.processTap, 4, .heardSound), "processTap/-")
        t.expectEqual(attempt(.processTap, 4, .failed(.tapCreateFailed)), "screenCaptureKit/tap-create-failed")
        t.expectEqual(attempt(.processTap, 4, .failed(.noBuffers)), "screenCaptureKit/no-buffers")
    }

    await tapFrameTests(t)
}

@MainActor
private func tapFrameTests(_ t: Harness) async {
    await t.test("tap frames are mono 16 kHz in whole 100 ms frames") {
        var converter = TapFrameConverter(sourceRate: 48_000)
        t.expectEqual(converter.outputRate, 16_000)
        // One second of 48 kHz stereo, constant 0.5 on both channels.
        let frames = push(&converter, interleaved: [Float](repeating: 0.5, count: 96_000), channels: 2)
        t.expectEqual(frames.count, 10)
        t.expect(frames.allSatisfy { $0.samples.count == 1_600 && $0.sampleRate == 16_000 && $0.durationMs == 100 })
        t.expect(frames.flatMap(\.samples).allSatisfy { abs($0 - 0.5) < 1e-5 }, "a constant stays the constant")
    }

    await t.test("stereo is averaged to mono, interleaved or planar") {
        var interleaved = TapFrameConverter(sourceRate: 48_000)
        var samples: [Float] = []
        for _ in 0..<4_800 { samples += [1, 0] }
        let mixed = push(&interleaved, interleaved: samples, channels: 2)
        t.expectEqual(mixed.count, 1)
        t.expect(mixed.flatMap(\.samples).allSatisfy { abs($0 - 0.5) < 1e-5 })

        var planar = TapFrameConverter(sourceRate: 48_000)
        let left = [Float](repeating: 1, count: 4_800)
        let right = [Float](repeating: -0.5, count: 4_800)
        let frames = left.withUnsafeBufferPointer { l in
            right.withUnsafeBufferPointer { r in planar.push(planar: [l, r]) }
        }
        t.expectEqual(frames.count, 1)
        t.expect(frames.flatMap(\.samples).allSatisfy { abs($0 - 0.25) < 1e-5 })
    }

    await t.test("small device buffers give the same samples as one large buffer") {
        let signal = sine(hz: 440, rate: 44_100, count: 44_100)
        var whole = TapFrameConverter(sourceRate: 44_100)
        let expected = push(&whole, interleaved: signal, channels: 1).flatMap(\.samples)
        var chunked = TapFrameConverter(sourceRate: 44_100)
        var actual: [Float] = []
        var start = 0
        while start < signal.count {
            let end = min(start + 512, signal.count)
            actual += push(&chunked, interleaved: Array(signal[start..<end]), channels: 1).flatMap(\.samples)
            start = end
        }
        // 44.1 kHz for one second is 16 000 output samples, less at most one held for the next buffer.
        t.expect(expected.count == 16_000 || expected.count == 14_400, "got \(expected.count)")
        t.expectEqual(actual.count, expected.count)
        t.expect(zip(actual, expected).allSatisfy { abs($0 - $1) < 1e-4 }, "chunking changed the samples")
    }

    await tapFrameEdgeTests(t)
}

@MainActor
private func tapFrameEdgeTests(_ t: Harness) async {
    await t.test("speech-band sound survives resampling and sound above the new band is attenuated") {
        var voice = TapFrameConverter(sourceRate: 48_000)
        let kept = peak(push(&voice, interleaved: sine(hz: 1_000, rate: 48_000, count: 48_000), channels: 1))
        t.expect(kept > 0.95 && kept <= 1.0001, "1 kHz peak \(kept)")
        var hiss = TapFrameConverter(sourceRate: 48_000)
        let cut = peak(push(&hiss, interleaved: sine(hz: 15_000, rate: 48_000, count: 48_000), channels: 1))
        t.expect(cut < 0.4, "15 kHz peak \(cut)")
    }

    await t.test("silence is not sound, and the first non-zero sample is") {
        var converter = TapFrameConverter(sourceRate: 48_000)
        _ = push(&converter, interleaved: [Float](repeating: 0, count: 9_600), channels: 2)
        t.expect(!converter.heardSound)
        _ = push(&converter, interleaved: [0, 0, 0.01, 0], channels: 2)
        t.expect(converter.heardSound)
    }

    await t.test("a rate at or below 16 kHz passes through, and bad input yields nothing") {
        var low = TapFrameConverter(sourceRate: 16_000)
        t.expectEqual(low.outputRate, 16_000)
        let same = push(&low, interleaved: sine(hz: 300, rate: 16_000, count: 1_600), channels: 1)
        t.expectEqual(same.first?.samples ?? [], sine(hz: 300, rate: 16_000, count: 1_600))
        var slow = TapFrameConverter(sourceRate: 8_000)
        t.expectEqual(slow.outputRate, 8_000)
        t.expectEqual(push(&slow, interleaved: [Float](repeating: 0.1, count: 1_600), channels: 1).count, 1)
        var none = TapFrameConverter(sourceRate: 0)
        t.expect(push(&none, interleaved: [1, 1, 1], channels: 1).isEmpty)
        var noChannels = TapFrameConverter(sourceRate: 48_000)
        t.expect(push(&noChannels, interleaved: [1, 1, 1], channels: 0).isEmpty)
        t.expect(noChannels.push(planar: []).isEmpty)
    }
}
