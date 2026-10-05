import CoreGraphics
import Foundation
import ImageIO
import Vision

// [DOMAIN] Apple Vision behind `TextObserving`. The request runs on a global
// queue (never the main actor) and is cancelled with the calling task, so the
// recognizer's time budget really stops the work. [SAFETY] Nothing is logged:
// not the image, not the text, not Vision's error text.
public struct VisionTextObserver: TextObserving {
    public init() {}

    // Whether this OS answers with at least one recognition language.
    public static let available: Bool = {
        guard let languages = try? VNRecognizeTextRequest().supportedRecognitionLanguages() else { return false }
        return !languages.isEmpty
    }()

    public var isAvailable: Bool { Self.available }

    public func observe(_ imageData: Data) async throws -> [TextObservation] {
        let box = RequestBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    continuation.resume(with: Result { try Self.run(imageData, box) })
                }
            }
        } onCancel: {
            box.cancel()
        }
    }

    private static func run(_ data: Data, _ box: RequestBox) throws -> [TextObservation] {
        try autoreleasepool {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { throw TextRecognitionError.unreadable }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            // English is the fallback language; detection widens it where the OS can.
            request.recognitionLanguages = ["en-US"]
            request.automaticallyDetectsLanguage = true
            guard box.adopt(request) else { throw CancellationError() }
            do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]) } catch {
                if box.isCancelled { throw CancellationError() }
                throw TextRecognitionError.unavailable
            }
            if box.isCancelled { throw CancellationError() }
            return (request.results ?? []).compactMap { observation in
                observation.topCandidates(1).first.map {
                    TextObservation(text: $0.string, confidence: Double($0.confidence), box: observation.boundingBox)
                }
            }
        }
    }
}

// Hands the running request to the cancellation handler, which runs on another thread.
private final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var request: VNRequest?
    private var cancelled = false

    var isCancelled: Bool { lock.withLock { cancelled } }

    // False when cancellation already happened: the request must not start.
    func adopt(_ request: VNRequest) -> Bool {
        lock.withLock {
            if cancelled { return false }
            self.request = request
            return true
        }
    }

    func cancel() {
        let running = lock.withLock { () -> VNRequest? in
            cancelled = true
            return request
        }
        running?.cancel()
    }
}
