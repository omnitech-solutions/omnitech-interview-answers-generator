import AVFoundation
import CaptureCore
import Foundation

// [DOMAIN] Microphone capture through AVAudioEngine, selected sources only.
// Frames are mono Float32 handed straight to Core's bounded ring buffer by the
// caller; nothing is written anywhere here. The engine is an OS object that
// callbacks touch from the audio thread, so the unchecked Sendable conformance
// is confined to this adapter.
public final class MicrophoneCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let onFrame: @Sendable (AudioFrame) -> Void
    private let onLost: @Sendable (DisconnectReason) -> Void
    private var observer: NSObjectProtocol?

    public init(
        onFrame: @escaping @Sendable (AudioFrame) -> Void,
        onLost: @escaping @Sendable (DisconnectReason) -> Void
    ) {
        self.onFrame = onFrame
        self.onLost = onLost
    }

    // Returns false when the person has not allowed microphone access: the
    // caller reports permission-revoked and the state is never "listening".
    public func start() async -> Bool {
        guard await Self.isAuthorized() else {
            onLost(.permissionRevoked)
            return false
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            onLost(.deviceLost)
            return false
        }
        let rate = Int(format.sampleRate)
        let onFrame = self.onFrame
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
            onFrame(AudioFrame(samples: samples, sampleRate: rate))
        }
        // A configuration change means the input device went away or changed.
        let onLost = self.onLost
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { _ in onLost(.deviceLost) }
        do {
            try engine.start()
            return true
        } catch {
            input.removeTap(onBus: 0)
            onLost(.error)
            return false
        }
    }

    public func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private static func isAuthorized() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }
}
