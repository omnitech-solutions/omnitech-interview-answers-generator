// [SAFETY] Raw audio is held only in this bounded in-memory ring buffer and is
// never persisted (rule:raw-audio-never-persisted). This file deliberately
// imports nothing: with no Foundation there is no file API in reach, and a
// test asserts the file stays free of imports and file-writing names.

public enum AudioDropReason: Sendable, Equatable {
    case paused, stopped, permissionRevoked, credentialExpired, sourceLost
}

public struct AudioFrame: Sendable {
    public var samples: [Float]
    public let sampleRate: Int

    public init(samples: [Float], sampleRate: Int) {
        self.samples = samples
        self.sampleRate = sampleRate
    }

    public var durationMs: Int { sampleRate > 0 ? samples.count * 1000 / sampleRate : 0 }
}

// Reported by push when the cap forced the oldest audio out, so the caller can
// record a capture.gap(buffer-overflow).
public struct AudioOverflow: Equatable, Sendable {
    public let droppedMs: Int

    public init(droppedMs: Int) { self.droppedMs = droppedMs }
}

// Single-threaded by design: the companion confines it to its capture queue.
public final class AudioRingBuffer {
    public let maxMs: Int
    private var frames: [AudioFrame] = []
    private var heldMs = 0
    public private(set) var lastDropReason: AudioDropReason?

    public init(maxSeconds: Int) { self.maxMs = maxSeconds * 1000 }

    public var bufferedMs: Int { heldMs }
    public var isEmpty: Bool { frames.isEmpty }

    // [INVARIANT] bufferedMs never exceeds the seconds cap; the oldest audio
    // is evicted first and reported, never silently lost.
    @discardableResult
    public func push(_ frame: AudioFrame) -> AudioOverflow? {
        frames.append(frame)
        heldMs += frame.durationMs
        var dropped = 0
        while heldMs > maxMs, !frames.isEmpty {
            var oldest = frames.removeFirst()
            dropped += oldest.durationMs
            heldMs -= oldest.durationMs
            Self.zero(&oldest)
        }
        return dropped > 0 ? AudioOverflow(droppedMs: dropped) : nil
    }

    // Hands buffered audio to the recogniser and empties the buffer.
    public func drain() -> [AudioFrame] {
        let out = frames
        frames = []
        heldMs = 0
        return out
    }

    // [SAFETY] Pause, stop, revocation and expiry discard audio unprocessed;
    // samples are overwritten with zeros before release.
    public func drop(reason: AudioDropReason) {
        for index in frames.indices { Self.zero(&frames[index]) }
        frames = []
        heldMs = 0
        lastDropReason = reason
    }

    private static func zero(_ frame: inout AudioFrame) {
        for index in frame.samples.indices { frame.samples[index] = 0 }
    }
}
