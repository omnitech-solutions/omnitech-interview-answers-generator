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
// [SAFETY] INVARIANT (@unchecked Sendable): every `var` is read and written only on
// `queue`: the public `start`/`feed`/`stop` dispatch onto it, the timer handler and the
// recognition callback hop onto it before touching state (`handle`, `checkSegmentEnd`,
// `discardRequest`, `ensureRequest` are only called from queue blocks), and the `let`s
// (`recognizer`, handlers) are set in `init` and used only there or on `queue`.
// Callers hand in and receive Sendable values; `onFinal`/`onFailure` run on `queue`.
// REMOVAL PLAN: an actor with a custom serial executor on `queue` (SE-0392) once the
// callers can make `start`/`feed`/`stop` async, or keep this as the audited exception.
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
    // Every frame heard, fed or not: the per-source clock segments are stamped by.
    private var clockMs = 0
    private var audioMsFed = 0
    private var requestStartMs = 0
    private var latestText = ""
    private var latestStartMs = 0
    private var latestEndMs = 0
    private var requestStartedAt = Date()
    private var lastVoiceAt = Date.distantPast
    private var endingSince: Date?
    // The frames just before a voice began, so the first word is not clipped.
    private var preroll: [AudioFrame] = []
    private var prerollMs = 0

    // [DOMAIN] This transcriber owns a request's lifetime, because the on-device
    // recogniser ends a request that does not begin with speech within about
    // half a second ("No speech detected") and would otherwise be reopened four
    // times a second for ever. A request opens when a frame is voiced (above
    // voiceDecibels, with the preroll in front), is ended by us after
    // silenceSeconds without voice or at maxRequestSeconds, and the text it
    // produced is final once the recogniser answers that ending (or after
    // endingGraceSeconds without an answer).
    private let voiceDecibels = -42.0
    private let prerollMaxMs = 600
    private let silenceSeconds = 1.2
    private let maxRequestSeconds = 50.0
    private let endingGraceSeconds = 3.0

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
            timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
            timer.setEventHandler { [weak self] in self?.checkSegmentEnd() }
            timer.resume()
            self.timer = timer
        }
    }

    public func feed(_ frames: [AudioFrame]) {
        guard !frames.isEmpty else { return }
        queue.async {
            for frame in frames {
                self.clockMs += frame.durationMs
                let voiced = Self.decibels(frame) >= self.voiceDecibels
                if voiced { self.lastVoiceAt = Date() }
                if self.request == nil || self.endingSince != nil {
                    // Silence between utterances is remembered, never fed.
                    guard voiced else {
                        self.keepPreroll(frame)
                        continue
                    }
                    if self.endingSince != nil { self.discardRequest() }
                    let request = self.openRequest()
                    for earlier in self.preroll { self.append(earlier, to: request) }
                    self.preroll = []
                    self.prerollMs = 0
                }
                if let request = self.request { self.append(frame, to: request) }
            }
        }
    }

    // Discards anything not yet final: stop, pause and revocation never flush text.
    public func stop() {
        queue.async {
            self.timer?.cancel()
            self.timer = nil
            self.discardRequest()
            self.preroll = []
            self.prerollMs = 0
        }
    }

    // MARK: queue-confined

    private func keepPreroll(_ frame: AudioFrame) {
        preroll.append(frame)
        prerollMs += frame.durationMs
        while prerollMs > prerollMaxMs, let oldest = preroll.first {
            prerollMs -= oldest.durationMs
            preroll.removeFirst()
        }
    }

    private func append(_ frame: AudioFrame, to request: SFSpeechAudioBufferRecognitionRequest) {
        guard let buffer = Self.pcmBuffer(frame) else { return }
        request.append(buffer)
        audioMsFed += frame.durationMs
    }

    private func openRequest() -> SFSpeechAudioBufferRecognitionRequest {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        generation += 1
        let mine = generation
        requestStartMs = clockMs - prerollMs
        requestStartedAt = Date()
        endingSince = nil
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // Extract plain values here; the result object does not cross queues.
            let text = result?.bestTranscription.formattedString
            let segments = result?.bestTranscription.segments ?? []
            let start = segments.first.map { Int($0.timestamp * 1000) }
            let end = segments.last.map { Int(($0.timestamp + $0.duration) * 1000) }
            // [GUARD] The recogniser's own end of a request ("No speech
            // detected", 1110) is not a failure; a final result closes it too.
            // A failure carries the error as a code (domain/code), never its
            // message: the one thing the event log can say about WHY it stopped.
            let outcome: Outcome
            if let result, result.isFinal {
                outcome = .final
            } else if error != nil, result == nil {
                outcome =
                    Self.isSilenceEnd(error)
                    ? .silence : .failed((error as NSError?).map { "\($0.domain)/\($0.code)" } ?? "unknown")
            } else {
                outcome = .result
            }
            guard let transcriber = self else { return }
            transcriber.queue.async {
                transcriber.handle(generation: mine, text: text, startMs: start, endMs: end, outcome: outcome)
            }
        }
        self.request = request
        CompanionEvents.record(.system, "speech.request_opened", ["generation": "\(generation)"])
        return request
    }

    private enum Outcome { case result, final, silence, failed(String) }

    private func handle(generation mine: Int, text: String?, startMs: Int?, endMs: Int?, outcome: Outcome) {
        guard mine == generation else { return }
        switch outcome {
        case .result:
            guard let text, !text.isEmpty else { return }
            latestText = text
            latestStartMs = requestStartMs + (startMs ?? 0)
            latestEndMs = requestStartMs + (endMs ?? 0)
        case .final:
            if let text, !text.isEmpty {
                latestText = text
                latestStartMs = requestStartMs + (startMs ?? 0)
                latestEndMs = requestStartMs + (endMs ?? 0)
            }
            CompanionEvents.record(
                .system, "speech.request_final",
                ["generation": "\(mine)", "ended": endingSince == nil ? "false" : "true", "fedMs": "\(fedMs)"])
            flushSegment()
            discardRequest()
        case .silence:
            CompanionEvents.record(
                .system, "speech.silence_end",
                [
                    "generation": "\(mine)", "hadWords": latestText.isEmpty ? "false" : "true",
                    "ended": endingSince == nil ? "false" : "true", "fedMs": "\(fedMs)",
                ])
            flushSegment()
            discardRequest()
        case .failed(let code):
            CompanionEvents.record(.system, "speech.failed", ["generation": "\(mine)", "error": code])
            discardRequest()
            onFailure()
        }
    }

    private var fedMs: Int { audioMsFed - requestStartMs }

    private func checkSegmentEnd() {
        guard request != nil else { return }
        let now = Date()
        if let endingSince {
            // The recogniser was told the audio ended; it answers with a final
            // result or 1110. Past the grace, what it gave so far is final.
            guard now.timeIntervalSince(endingSince) >= endingGraceSeconds else { return }
            CompanionEvents.record(.system, "speech.request_timed_out", ["generation": "\(generation)"])
            flushSegment()
            discardRequest()
            return
        }
        let quiet = now.timeIntervalSince(lastVoiceAt) >= silenceSeconds
        let long = now.timeIntervalSince(requestStartedAt) >= maxRequestSeconds
        guard quiet || long else { return }
        endingSince = now
        request?.endAudio()
    }

    // Hands over whatever text the current request produced, if any.
    private func flushSegment() {
        guard !latestText.isEmpty else { return }
        let text = latestText
        let start = latestStartMs
        let end = max(latestEndMs, start)
        latestText = ""
        // Sizes only (rule:id-only-traces): the text itself never enters a log.
        CompanionEvents.record(.system, "speech.segment_final", ["chars": "\(text.count)", "ms": "\(end - start)"])
        onFinal(text, start, end)
    }

    static func isSilenceEnd(_ error: Error?) -> Bool {
        guard let error = error as NSError? else { return false }
        return error.domain == "kAFAssistantErrorDomain" && error.code == 1110
    }

    private func discardRequest() {
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        latestText = ""
        endingSince = nil
        generation += 1
    }

    // Loudness of one frame in dBFS (RMS); silence is far below -60.
    static func decibels(_ frame: AudioFrame) -> Double {
        guard !frame.samples.isEmpty else { return -120 }
        var sum = 0.0
        for sample in frame.samples { sum += Double(sample * sample) }
        return 20 * log10(max((sum / Double(frame.samples.count)).squareRoot(), 1e-6))
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
