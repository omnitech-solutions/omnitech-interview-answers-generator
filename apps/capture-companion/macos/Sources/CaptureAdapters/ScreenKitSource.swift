import CaptureCore
import CoreGraphics
import CoreImage
import CoreMedia
import Foundation
import ScreenCaptureKit

// [DOMAIN] One ScreenCaptureKit stream for exactly one selected source: the
// screen (a window or the main display) or application audio. Which of them
// runs is the person's choice at start; this class cannot add a source.
// Permission loss surfaces as a stream stop error, which Core turns into the
// visible permission-revoked state. Unchecked Sendable is confined here: the
// stream's callbacks run on `sampleQueue`, which owns all mutable state.
public final class ScreenKitSource: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    public enum Kind: Sendable {
        case screen(windowTitleContains: String?)
        case applicationAudio
    }

    public typealias AudioHandler = @Sendable (AudioFrame) -> Void
    public typealias ScreenshotHandler = @Sendable (_ jpeg: Data, _ windowLabel: String) -> Void

    private let kind: Kind
    private let onAudio: AudioHandler
    private let onScreenshot: ScreenshotHandler
    private let onLost: @Sendable (DisconnectReason) -> Void
    private let sampleQueue = DispatchQueue(label: "companion.screenkit.samples")
    private let imageContext = CIContext()
    private var stream: SCStream?
    private var policy = ChangePolicy()
    private var label = "display"

    public init(
        kind: Kind, onAudio: @escaping AudioHandler, onScreenshot: @escaping ScreenshotHandler,
        onLost: @escaping @Sendable (DisconnectReason) -> Void
    ) {
        self.kind = kind
        self.onAudio = onAudio
        self.onScreenshot = onScreenshot
        self.onLost = onLost
    }

    // Returns false (after reporting why) when capture could not start.
    public func start() async -> Bool {
        if case .screen = kind, !CGPreflightScreenCaptureAccess(), !CGRequestScreenCaptureAccess() {
            onLost(.permissionRevoked)
            return false
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                onLost(.deviceLost)
                return false
            }
            let configuration = SCStreamConfiguration()
            let filter: SCContentFilter
            switch kind {
            case .screen(let titleFragment):
                switch ScreenTarget.choose(titleFragment: titleFragment, windowTitles: content.windows.map(\.title)) {
                case .window(let index):
                    let window = content.windows[index]
                    filter = SCContentFilter(desktopIndependentWindow: window)
                    // [SAFETY] Only the application name is sent as the label, never a window title.
                    label = window.owningApplication?.applicationName ?? "window"
                case .display:
                    filter = SCContentFilter(display: display, excludingWindows: [])
                case .windowNotFound:
                    // [SAFETY] Never widen a named window to the whole display: refuse visibly instead.
                    onLost(.deviceLost)
                    return false
                }
                configuration.width = min(display.width, 1920)
                configuration.height = min(display.height, 1080)
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                configuration.showsCursor = false
            case .applicationAudio:
                filter = SCContentFilter(display: display, excludingWindows: [])
                configuration.capturesAudio = true
                configuration.excludesCurrentProcessAudio = true
                configuration.channelCount = 1
                configuration.sampleRate = 16000
                // Only audio output is added below; keep the unused video minimal.
                configuration.width = 2
                configuration.height = 2
            }
            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            switch kind {
            case .screen: try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
            case .applicationAudio: try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
            }
            try await stream.startCapture()
            self.stream = stream
            return true
        } catch {
            // Not authorised (or revoked) is the common cause of a start failure.
            onLost(.permissionRevoked)
            return false
        }
    }

    public func stop() async {
        let stream = self.stream
        self.stream = nil
        try? await stream?.stopCapture()
    }

    // MARK: SCStreamDelegate

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        onLost(.permissionRevoked)
    }

    // MARK: SCStreamOutput

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sampleBuffer.isValid else { return }
        switch type {
        case .audio:
            if let frame = Self.audioFrame(sampleBuffer) { onAudio(frame) }
        case .screen:
            handleScreen(sampleBuffer)
        default:
            return
        }
    }

    // [GUARD] Only a meaningfully changed frame is encoded and sent, so most
    // frames cost one 9x8 draw and are dropped.
    private func handleScreen(_ sampleBuffer: CMSampleBuffer) {
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let image = CIImage(cvPixelBuffer: pixels)
        guard let cgImage = imageContext.createCGImage(image, from: image.extent),
            let frame = ImageEncoder.lumaFrame(cgImage),
            policy.evaluate(frame, at: Date()) == .send,
            let jpeg = ImageEncoder.jpeg(cgImage, maxBytes: ActiveSessionLimits.maxScreenshotBytes)
        else { return }
        onScreenshot(jpeg, label)
    }

    private static func audioFrame(_ sampleBuffer: CMSampleBuffer) -> AudioFrame? {
        var list = AudioBufferList()
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: &list,
            bufferListSize: MemoryLayout<AudioBufferList>.size, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &blockBuffer)
        guard status == noErr, let data = list.mBuffers.mData,
            let description = CMSampleBufferGetFormatDescription(sampleBuffer),
            let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)
        else { return nil }
        let count = Int(list.mBuffers.mDataByteSize) / MemoryLayout<Float>.size
        let samples = Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self), count: count))
        return AudioFrame(samples: samples, sampleRate: Int(basic.pointee.mSampleRate))
    }
}
