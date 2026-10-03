import AVFoundation
import CaptureCore
import Foundation
import Speech

// [SAFETY] Speech is recognised ONLY on this Mac, ALWAYS: every request sets
// requiresOnDeviceRecognition = true and nothing in this module can turn that
// off (a source scan test fails if it ever appears as false). This file has no
// network types at all; a locale or model that is not available on-device is a
// visible failure in Core's capability check, never a reason to recognise elsewhere.

private func normalizedLocale(_ identifier: String) -> String { identifier.replacingOccurrences(of: "-", with: "_") }

public struct OnDeviceSpeechProbe: SpeechCapabilityProbe {
    public init() {}

    public func probe(locale: String) async -> SpeechProbeResult {
        let wanted = normalizedLocale(locale)
        let supported = SFSpeechRecognizer.supportedLocales().contains { normalizedLocale($0.identifier) == wanted }
        guard supported, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: wanted)) else {
            return SpeechProbeResult(
                localeSupported: false, onDeviceSupported: false, recognizerAvailable: false,
                authorization: Self.map(SFSpeechRecognizer.authorizationStatus()))
        }
        let status = await Self.requestAuthorization()
        return SpeechProbeResult(
            localeSupported: true,
            onDeviceSupported: recognizer.supportsOnDeviceRecognition,
            recognizerAvailable: recognizer.isAvailable,
            authorization: Self.map(status))
    }

    private static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }

    private static func map(_ status: SFSpeechRecognizerAuthorizationStatus) -> SpeechAuthorization {
        switch status {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .restricted
        }
    }
}

public struct SystemPermissionProbe: PermissionProbe {
    public init() {}

    public func microphone() async -> PermissionState {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    // Preflight only: asking is the screen source's own start-up step.
    public func screen() async -> PermissionState { CGPreflightScreenCaptureAccess() ? .granted : .notDetermined }
}

// Turns a stream of audio frames into final transcript segments for one source.
// All mutable state is confined to `queue`; callers hand in Sendable values and
// receive Sendable values, so the unchecked conformance stays at this edge.
public final class OnDeviceTranscriber: @unchecked Sendable {
    public typealias Final = @Sendable (_ text: String, _ startMs: Int, _ endMs: Int) -> Void

    private let queue = DispatchQueue(label: "companion.transcriber")
    private let recognizer: SFSpeechRecognizer
    private let onFinal: Final
    private let onFailure: @Sendable () -> Void
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timer: DispatchSourceTimer?
    private var generation = 0
    private var audioMsFed = 0
    private var requestStartMs = 0
    private var latestText = ""
    private var latestStartMs = 0
    private var latestEndMs = 0
    private var lastUpdate = Date()
    private var requestStartedAt = Date()

    // A segment is final after this much silence, or at the latest this long
    // after it began (the on-device recogniser limits one request's length).
    private let silenceSeconds = 1.2
    private let maxRequestSeconds = 50.0

    // nil unless the locale is supported AND supports on-device recognition.
    public init?(locale: String, onFinal: @escaping Final, onFailure: @escaping @Sendable () -> Void) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: normalizedLocale(locale))),
            recognizer.supportsOnDeviceRecognition
        else { return nil }
        self.recognizer = recognizer
        self.onFinal = onFinal
        self.onFailure = onFailure
    }

    public func start() {
        queue.async {
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
            timer.setEventHandler { [weak self] in self?.checkSegmentEnd() }
            timer.resume()
            self.timer = timer
        }
    }

    public func feed(_ frames: [AudioFrame]) {
        guard !frames.isEmpty else { return }
        queue.async {
            for frame in frames {
                guard let buffer = Self.pcmBuffer(frame) else { continue }
                self.ensureRequest().append(buffer)
                self.audioMsFed += frame.durationMs
            }
        }
    }

    // Discards anything not yet final: stop, pause and revocation never flush text.
    public func stop() {
        queue.async {
            self.timer?.cancel()
            self.timer = nil
            self.discardRequest()
        }
    }

    // MARK: queue-confined

    private func ensureRequest() -> SFSpeechAudioBufferRecognitionRequest {
        if let request { return request }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        generation += 1
        let mine = generation
        requestStartMs = audioMsFed
        requestStartedAt = Date()
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // Extract plain values here; the result object does not cross queues.
            let text = result?.bestTranscription.formattedString
            let segments = result?.bestTranscription.segments ?? []
            let start = segments.first.map { Int($0.timestamp * 1000) }
            let end = segments.last.map { Int(($0.timestamp + $0.duration) * 1000) }
            let failed = error != nil && result == nil
            guard let transcriber = self else { return }
            transcriber.queue.async {
                transcriber.handle(generation: mine, text: text, startMs: start, endMs: end, failed: failed)
            }
        }
        self.request = request
        return request
    }

    private func handle(generation mine: Int, text: String?, startMs: Int?, endMs: Int?, failed: Bool) {
        guard mine == generation else { return }
        if failed {
            discardRequest()
            onFailure()
            return
        }
        guard let text, !text.isEmpty else { return }
        latestText = text
        latestStartMs = requestStartMs + (startMs ?? 0)
        latestEndMs = requestStartMs + (endMs ?? 0)
        lastUpdate = Date()
    }

    private func checkSegmentEnd() {
        guard request != nil, !latestText.isEmpty else { return }
        let quiet = Date().timeIntervalSince(lastUpdate) >= silenceSeconds
        let long = Date().timeIntervalSince(requestStartedAt) >= maxRequestSeconds
        guard quiet || long else { return }
        let text = latestText
        let start = latestStartMs
        let end = max(latestEndMs, start)
        discardRequest()
        onFinal(text, start, end)
    }

    private func discardRequest() {
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        latestText = ""
        generation += 1
    }

    private static func pcmBuffer(_ frame: AudioFrame) -> AVAudioPCMBuffer? {
        guard frame.sampleRate > 0, !frame.samples.isEmpty,
            let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: Double(frame.sampleRate), channels: 1, interleaved: false),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frame.samples.count)),
            let channel = buffer.floatChannelData?[0]
        else { return nil }
        buffer.frameLength = AVAudioFrameCount(frame.samples.count)
        frame.samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: frame.samples.count) }
        return buffer
    }
}
