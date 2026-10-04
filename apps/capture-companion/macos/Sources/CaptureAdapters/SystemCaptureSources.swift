import CaptureCore
import Foundation

// What the capture adapters report back. All values are Sendable plain data;
// the caller hops them onto its own actor before touching Core.
public struct CaptureEvents: Sendable {
    public let onAudio: @Sendable (CaptureSource, AudioFrame) -> Void
    public let onScreenshot: @Sendable (_ jpeg: Data, _ windowLabel: String) -> Void
    public let onLost: @Sendable (CaptureSource, DisconnectReason) -> Void

    public init(
        onAudio: @escaping @Sendable (CaptureSource, AudioFrame) -> Void,
        onScreenshot: @escaping @Sendable (Data, String) -> Void,
        onLost: @escaping @Sendable (CaptureSource, DisconnectReason) -> Void
    ) {
        self.onAudio = onAudio
        self.onScreenshot = onScreenshot
        self.onLost = onLost
    }
}

// [SAFETY] Core's SourceControl over the real capture objects. Only sources in
// the person's selection are ever constructed, so there is nothing here that
// could start another one. start() returns at once; the OS start-up (and any
// permission prompt) completes asynchronously and reports through onLost.
public final class SystemCaptureSources: SourceControl, Sendable {
    private let microphone: MicrophoneCapture?
    private let applicationAudio: ScreenKitSource?
    private let screen: ScreenKitSource?
    private let screenSelected: Bool

    public init(selection: Set<CaptureSource>, windowTitleContains: String?, events: CaptureEvents) {
        microphone = selection.contains(.microphone)
            ? MicrophoneCapture(
                onFrame: { events.onAudio(.microphone, $0) },
                onLost: { events.onLost(.microphone, $0) })
            : nil
        applicationAudio = selection.contains(.applicationAudio)
            ? ScreenKitSource(
                kind: .applicationAudio, onAudio: { events.onAudio(.applicationAudio, $0) },
                onScreenshot: { _, _ in }, onLost: { events.onLost(.applicationAudio, $0) })
            : nil
        screenSelected = selection.contains(.screen)
        screen = selection.contains(.screen)
            ? ScreenKitSource(
                kind: .screen(windowTitleContains: windowTitleContains), onAudio: { _ in },
                onScreenshot: events.onScreenshot, onLost: { events.onLost(.screen, $0) })
            : nil
    }

    public func start(_ source: CaptureSource) {
        switch source {
        case .microphone:
            guard let microphone else { return }
            Task { _ = await microphone.start() }
        case .applicationAudio:
            guard let applicationAudio else { return }
            Task { _ = await applicationAudio.start() }
        case .screen:
            guard let screen else { return }
            Task { _ = await screen.start() }
        }
    }

    // [SAFETY] One capture for a capture-now request. Only a screen source the
    // person selected at start can capture; otherwise nothing is captured.
    public func captureOnce(_ request: CaptureRequest) async -> CaptureOutcome {
        guard screenSelected else { return .lost(.captureFailed) }
        return await ScreenKitOneShot.capture(request)
    }

    // The microphone stops synchronously; ScreenCaptureKit streams are asked
    // to stop and finish on their own queue.
    public func stop(_ source: CaptureSource) {
        switch source {
        case .microphone: microphone?.stop()
        case .applicationAudio:
            guard let applicationAudio else { return }
            Task { await applicationAudio.stop() }
        case .screen:
            guard let screen else { return }
            Task { await screen.stop() }
        }
    }
}
