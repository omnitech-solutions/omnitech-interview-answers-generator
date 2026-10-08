// [DOMAIN] Turns what a Core Audio process tap delivers (Float32 at the output
// device's rate, usually 48 kHz stereo) into the frames the rest of the
// companion already takes from ScreenCaptureKit: mono Float32 at 16 kHz.
// Pure arithmetic over values, so it is tested with synthetic buffers and no
// audio hardware. Like the ring buffer, it imports nothing and writes nothing.
// [STRATEGY] Three steps per buffer: average the channels into one, average
// each span of input that one output sample covers (a box low-pass matched to
// the output rate, so 48 kHz does not alias into 16 kHz), and hand over whole
// 100 ms frames. Whole frames keep `AudioFrame.durationMs` exact: it truncates,
// and many 10.67 ms device buffers would run the transcript clock slow.
public struct TapFrameConverter: Sendable {
    public static let targetRate = 16_000
    public static let frameSamples = 1_600

    public let outputRate: Int
    private let step: Double
    private var weighted = 0.0
    private var covered = 0.0
    private var pending: [Float] = []
    public private(set) var heardSound = false

    // [GUARD] A rate at or below the target is passed through at its own rate
    // (frames carry their rate); this type never invents samples by upsampling.
    public init(sourceRate: Double) {
        if sourceRate > Double(Self.targetRate) {
            outputRate = Self.targetRate
            step = sourceRate / Double(Self.targetRate)
        } else {
            outputRate = max(Int(sourceRate), 0)
            step = 1
        }
    }

    // One interleaved buffer (L R L R ...). A trailing partial sample group is ignored.
    public mutating func push(interleaved samples: UnsafeBufferPointer<Float>, channels: Int) -> [AudioFrame] {
        guard channels > 0, outputRate > 0 else { return [] }
        let count = samples.count / channels
        let scale = 1 / Float(channels)
        for index in 0..<count {
            var sum: Float = 0
            for channel in 0..<channels { sum += samples[index * channels + channel] }
            add(sum * scale)
        }
        return takeFrames()
    }

    // One buffer per channel; the shortest channel bounds the count.
    public mutating func push(planar channels: [UnsafeBufferPointer<Float>]) -> [AudioFrame] {
        guard let count = channels.map(\.count).min(), outputRate > 0 else { return [] }
        let scale = 1 / Float(channels.count)
        for index in 0..<count {
            var sum: Float = 0
            for channel in channels { sum += channel[index] }
            add(sum * scale)
        }
        return takeFrames()
    }

    // [STRATEGY] INVARIANT: `covered` < `step` is how much input the output
    // sample being built has taken, and `weighted` is its sum. An input sample
    // that crosses an output boundary is split between the two by weight.
    private mutating func add(_ sample: Float) {
        if !heardSound, sample != 0 { heardSound = true }
        let value = Double(sample)
        var remaining = 1.0
        while covered + remaining >= step {
            let take = step - covered
            pending.append(Float((weighted + value * take) / step))
            weighted = 0
            covered = 0
            remaining -= take
        }
        weighted += value * remaining
        covered += remaining
    }

    private mutating func takeFrames() -> [AudioFrame] {
        var frames: [AudioFrame] = []
        var start = 0
        while pending.count - start >= Self.frameSamples {
            frames.append(
                AudioFrame(samples: Array(pending[start..<start + Self.frameSamples]), sampleRate: outputRate))
            start += Self.frameSamples
        }
        if start > 0 { pending.removeFirst(start) }
        return frames
    }
}
