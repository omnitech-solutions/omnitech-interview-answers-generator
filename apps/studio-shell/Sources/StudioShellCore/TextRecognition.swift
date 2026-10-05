import CoreGraphics
import Foundation
import ImageIO

// [DOMAIN] On-device text recognition (decision D31). Every screenshot is read
// on the device before it goes to the model, so the model gets exact text and
// numbers beside the image. The recognizer (Vision) sits behind `TextObserving`
// so the decisions below (bounds, reading order, truncation, time budget) are
// tested without Vision. [SAFETY] The image and its text are never logged; the
// only diagnostics are fixed words.

// Why recognition produced nothing. Closed names the page can show.
public enum OcrFailure: String, Equatable, Sendable {
    case tooLarge = "too-large"
    case unreadable
    case timeout
    case unavailable
}

public enum TextRecognitionError: Error, Equatable, Sendable {
    case unreadable
    case unavailable
}

// One recognised run of text with its box, normalised to the image with the
// origin at the bottom left (Vision's convention).
public struct TextObservation: Equatable, Sendable {
    public let text: String
    public let confidence: Double
    public let box: CGRect

    public init(text: String, confidence: Double, box: CGRect) {
        self.text = text
        self.confidence = confidence
        self.box = box
    }
}

public struct OcrText: Equatable, Sendable {
    public static let engine = "vision"
    public let text: String
    // Mean confidence of the observations, 0...1.
    public let confidence: Double
    // True when the text was cut at the character bound.
    public let truncated: Bool
    // Where the text sits in the frame (D35); nil when not measured.
    public let metrics: OcrMetrics?

    public init(text: String, confidence: Double, truncated: Bool, metrics: OcrMetrics? = nil) {
        self.text = text
        self.confidence = confidence
        self.truncated = truncated
        self.metrics = metrics
    }

    // The block a capture result carries as `ocr`, and the body of a recognizeText reply.
    public var wire: [String: Any] {
        var block: [String: Any] = [
            "engine": Self.engine, "text": text, "confidence": confidence, "truncated": truncated,
        ]
        if let metrics { block["metrics"] = metrics.wire }
        return block
    }
}

public enum TextRecognitionOutcome: Equatable, Sendable {
    case recognized(OcrText)
    case failed(OcrFailure)
}

// The recognizer behind the component: one image in, observations out. A fake
// stands in for Vision in tests. `observe` honours task cancellation.
public protocol TextObserving: Sendable {
    var isAvailable: Bool { get }
    func observe(_ imageData: Data) async throws -> [TextObservation]
}

// [DOMAIN] Observations become one block of text in reading order: lines top to
// bottom, left to right within a line (observations whose vertical extents
// overlap share a line), whitespace normalised, bounded at a line boundary.
public enum ReadingOrder {
    public static let maxCharacters = 20_000

    public static func compose(_ observations: [TextObservation], maxCharacters: Int = maxCharacters) -> OcrText {
        // [GUARD] Empty runs carry nothing; whitespace is collapsed per run.
        let runs = observations.compactMap { each -> TextObservation? in
            let text = normalised(each.text)
            return text.isEmpty ? nil : TextObservation(text: text, confidence: each.confidence, box: each.box)
        }
        // [STRATEGY] Highest first (Vision's y grows upward), then left to right.
        let sorted = runs.sorted {
            $0.box.midY != $1.box.midY ? $0.box.midY > $1.box.midY : $0.box.minX < $1.box.minX
        }
        var lines: [[TextObservation]] = []
        for run in sorted {
            // A run joins the current line when it overlaps the line's first run
            // by more than half of the smaller height.
            if let head = lines.last?.first, sharesLine(head.box, run.box) {
                lines[lines.count - 1].append(run)
            } else {
                lines.append([run])
            }
        }
        let rendered = lines.map { line in
            line.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ")
        }
        let (text, truncated) = bounded(rendered, maxCharacters: maxCharacters)
        let mean = runs.isEmpty ? 0 : runs.reduce(0) { $0 + $1.confidence } / Double(runs.count)
        // [STATE] Metrics describe every box Vision found, not only the kept text.
        let metrics = OcrMetrics.measure(boxes: runs.map { (box: $0.box, confidence: $0.confidence) })
        return OcrText(text: text, confidence: min(1, max(0, mean)), truncated: truncated, metrics: metrics)
    }

    private static func normalised(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func sharesLine(_ line: CGRect, _ other: CGRect) -> Bool {
        let overlap = min(line.maxY, other.maxY) - max(line.minY, other.minY)
        let smaller = min(line.height, other.height)
        return smaller > 0 && overlap > smaller / 2
    }

    // [SAFETY] Whole lines up to the bound; a single line longer than the bound
    // is cut by characters, the only case that is not a line boundary.
    private static func bounded(_ lines: [String], maxCharacters: Int) -> (String, Bool) {
        var kept: [String] = []
        var used = 0
        for line in lines {
            let next = used + line.count + (kept.isEmpty ? 0 : 1)
            if next > maxCharacters {
                if kept.isEmpty { return (String(line.prefix(maxCharacters)), true) }
                return (kept.joined(separator: "\n"), true)
            }
            kept.append(line)
            used = next
        }
        return (kept.joined(separator: "\n"), false)
    }
}

// [DOMAIN] A one-shot result: the first `finish` resumes the waiting caller and cancels
// the tasks that raced for it; every later one is dropped.
final class DeadlineRace<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value?, Never>?
    private var tasks: [Task<Void, Never>] = []
    private var done = false
    private var early: Value??

    func start(_ continuation: CheckedContinuation<Value?, Never>) {
        let ready = lock.withLock { () -> Value?? in
            if let early { return early }
            self.continuation = continuation
            return nil
        }
        if let ready { continuation.resume(returning: ready) }
    }

    func adopt(_ task: Task<Void, Never>) {
        let cancelNow = lock.withLock { () -> Bool in
            if done { return true }
            tasks.append(task)
            return false
        }
        if cancelNow { task.cancel() }
    }

    func finish(_ value: Value?) {
        let (waiting, losers) = lock.withLock { () -> (CheckedContinuation<Value?, Never>?, [Task<Void, Never>]) in
            guard !done else { return (nil, []) }
            done = true
            let waiting = continuation
            continuation = nil
            if waiting == nil { early = .some(value) }
            return (waiting, tasks)
        }
        waiting?.resume(returning: value)
        for loser in losers { loser.cancel() }
    }
}

// [DOMAIN] Bounds the input, runs the observer inside a cancellable time
// budget, and composes the result. Safe to call from any actor: it is a value
// and the work runs off the caller's executor.
public struct TextRecognizer: Sendable {
    // The page's frames are fitted to FrameSize.maxLongEdge before encoding, so
    // a larger image did not come from a capture and is refused.
    public static let maxLongEdge = FrameSize.maxLongEdge
    public static let maxImageBytes = 2 * 1024 * 1024
    // The base64 text of an image at the byte bound.
    public static let maxBase64Characters = (maxImageBytes + 2) / 3 * 4
    public static let defaultBudget: Duration = .seconds(10)
    // PNG, JPEG and WebP: what the page can hold from a capture or a crop.
    public static let imageTypes: Set<String> = ["public.png", "public.jpeg", "org.webmproject.webp"]
    public static let mediaTypes: Set<String> = ["image/png", "image/jpeg", "image/webp"]

    private let observer: any TextObserving

    public init(observer: any TextObserving) { self.observer = observer }

    public var isAvailable: Bool { observer.isAvailable }

    public func recognize(base64: String, within budget: Duration = defaultBudget) async -> TextRecognitionOutcome {
        guard base64.utf8.count <= Self.maxBase64Characters else { return .failed(.tooLarge) }
        guard let data = Data(base64Encoded: base64) else { return .failed(.unreadable) }
        return await recognize(data, within: budget)
    }

    public func recognize(_ data: Data, within budget: Duration = defaultBudget) async -> TextRecognitionOutcome {
        guard observer.isAvailable else { return .failed(.unavailable) }
        guard data.count <= Self.maxImageBytes else { return .failed(.tooLarge) }
        // [GUARD] Dimensions come from the header: an oversized image is refused
        // before any pixel is decoded.
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let type = CGImageSourceGetType(source) as String?, Self.imageTypes.contains(type),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int, width > 0, height > 0
        else { return .failed(.unreadable) }
        guard max(width, height) <= Self.maxLongEdge else { return .failed(.tooLarge) }

        // [STRATEGY] The observer races the deadline, and the DEADLINE wins at the deadline: the
        // caller's continuation is resumed by whichever finishes first (a lock-guarded
        // one-shot) and the loser is cancelled. A structured task group would wait for every
        // child, so an observer that ignores cancellation (a slow Vision cancel, a long
        // decode) would hold the caller past its budget; here its late result is dropped.
        enum Step: Sendable {
            case observed(Result<[TextObservation], TextRecognitionError>)
            case timedOut
        }
        let race = DeadlineRace<Step>()
        let step: Step? = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                race.start(continuation)
                race.adopt(Task {
                    do { race.finish(.observed(.success(try await observer.observe(data)))) } catch let error as TextRecognitionError {
                        race.finish(.observed(.failure(error)))
                    } catch { race.finish(nil) }
                })
                race.adopt(Task {
                    do { try await Task.sleep(for: budget) } catch { return }
                    race.finish(.timedOut)
                })
            }
        } onCancel: {
            race.finish(nil)
        }
        switch step {
        case .observed(.success(let observations)): return .recognized(ReadingOrder.compose(observations))
        case .observed(.failure(let error)): return .failed(error == .unreadable ? .unreadable : .unavailable)
        case .timedOut: return .failed(.timeout)
        case nil: return .failed(.unavailable)
        }
    }
}
