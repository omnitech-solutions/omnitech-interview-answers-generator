import CaptureCore
import CoreAudio
import Foundation

// [DOMAIN] The call's audio through a Core Audio process tap (macOS 14.4+):
// one global mono mixdown of every process EXCEPT this one, read through a
// private aggregate device that holds only the tap. There is no
// ScreenCaptureKit stream, so macOS shows no "Currently Sharing" indicator;
// the tap asks for "System Audio Recording Only" instead. The tap is unmuted:
// the person keeps hearing the call exactly as before.
// [SAFETY] Samples go to `onAudio` as AudioFrame values and nowhere else:
// nothing is written, kept or logged here.
// [SAFETY] INVARIANT (@unchecked Sendable): every `var` is read and written
// only on `queue`. `start` and `stop` run their bodies with `queue.sync`, the
// IO block is delivered on `queue` (Core Audio dispatches it there), and the
// watchdog timer fires on `queue`. The handlers are immutable @Sendable `let`s
// and are called on `queue`; they must not call `start` or `stop` synchronously.
@available(macOS 14.4, *)
public final class ProcessTapSource: @unchecked Sendable {
    // Why a running tap ended by itself.
    public enum End: Sendable {
        // Started, but no buffer ever arrived: the tap does not work here.
        case neverDelivered
        // Buffers arrived and then stopped: the device under it went away.
        case stalled
    }

    private let onAudio: @Sendable (AudioFrame) -> Void
    private let onSound: @Sendable () -> Void
    private let onEnd: @Sendable (End) -> Void
    private let queue = DispatchQueue(label: "companion.processtap")
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var converter: TapFrameConverter?
    private var watchdog: DispatchSourceTimer?
    private var lastBufferAt = DispatchTime.now()
    private var delivered = false
    private var reportedSound = false

    // A tap that is silent for this long is not silent: it is not running.
    // (A running tap delivers zero-filled buffers while nothing plays.)
    private let stallSeconds = 5.0

    public init(
        onAudio: @escaping @Sendable (AudioFrame) -> Void, onSound: @escaping @Sendable () -> Void,
        onEnd: @escaping @Sendable (End) -> Void
    ) {
        self.onAudio = onAudio
        self.onSound = onSound
        self.onEnd = onEnd
    }

    // nil when the tap is running; otherwise why not, with everything undone.
    public func start() -> TapUnavailableReason? {
        queue.sync {
            guard ioProcID == nil else { return nil }
            let failure = build()
            if failure != nil { teardown() }
            return failure
        }
    }

    public func stop() {
        queue.sync { teardown() }
    }

    // MARK: queue-confined

    private func build() -> TapUnavailableReason? {
        // [SAFETY] This process is excluded, so the app never hears itself.
        // A process that has played no audio has no audio object to exclude.
        let own = Self.ownProcessObject()
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: own.map { [$0] } ?? [])
        description.uuid = UUID()
        description.name = "Interview Studio call audio"
        description.isPrivate = true
        // [SAFETY] Never mute: the tap listens beside the speakers, it does not replace them.
        description.muteBehavior = .unmuted
        guard AudioHardwareCreateProcessTap(description, &tapID) == noErr, tapID != kAudioObjectUnknown else {
            return .tapCreateFailed
        }

        // [GUARD] Only 32-bit float PCM is read; anything else is a visible failure, never a guess.
        guard let format = Self.tapFormat(tapID), format.mFormatID == kAudioFormatLinearPCM,
            format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32,
            format.mSampleRate > 0
        else { return .formatUnreadable }
        converter = TapFrameConverter(sourceRate: format.mSampleRate)

        // A private aggregate device with the tap as its only member: nothing
        // appears in the person's device list and no other device's streams
        // are mixed into what is read.
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Interview Studio call audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]
            ],
        ]
        guard AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID) == noErr,
            aggregateID != kAudioObjectUnknown
        else { return .aggregateCreateFailed }

        let created = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, queue) {
            [weak self] _, input, _, _, _ in
            self?.read(input)
        }
        guard created == noErr, let ioProcID else { return .ioProcFailed }
        guard AudioDeviceStart(aggregateID, ioProcID) == noErr else { return .startFailed }

        delivered = false
        reportedSound = false
        lastBufferAt = .now()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.checkStall() }
        timer.resume()
        watchdog = timer
        return nil
    }

    // One device buffer: interleaved in a single buffer, or one buffer per channel.
    private func read(_ input: UnsafePointer<AudioBufferList>) {
        guard ioProcID != nil, var converter else { return }
        lastBufferAt = .now()
        delivered = true
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        let frames: [AudioFrame]
        if buffers.count == 1, let buffer = buffers.first {
            frames = converter.push(interleaved: Self.floats(buffer), channels: Int(buffer.mNumberChannels))
        } else {
            frames = converter.push(planar: buffers.filter { $0.mNumberChannels == 1 }.map(Self.floats))
        }
        self.converter = converter
        if converter.heardSound, !reportedSound {
            reportedSound = true
            onSound()
        }
        for frame in frames { onAudio(frame) }
    }

    private func checkStall() {
        guard ioProcID != nil else { return }
        let quietFor = Double(DispatchTime.now().uptimeNanoseconds - lastBufferAt.uptimeNanoseconds) / 1e9
        guard quietFor >= stallSeconds else { return }
        let end: End = delivered ? .stalled : .neverDelivered
        teardown()
        onEnd(end)
    }

    // Undoes whatever `build` got to, in reverse order. Safe to call twice.
    private func teardown() {
        watchdog?.cancel()
        watchdog = nil
        if let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
        }
        ioProcID = nil
        if aggregateID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregateID) }
        aggregateID = AudioObjectID(kAudioObjectUnknown)
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        tapID = AudioObjectID(kAudioObjectUnknown)
        converter = nil
    }

    private static func floats(_ buffer: AudioBuffer) -> UnsafeBufferPointer<Float> {
        UnsafeBufferPointer(
            start: buffer.mData?.assumingMemoryBound(to: Float.self),
            count: buffer.mData == nil ? 0 : Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
    }

    private static func ownProcessObject() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var pid = getpid()
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }

    private static func tapFormat(_ tap: AudioObjectID) -> AudioStreamBasicDescription? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        return AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format) == noErr ? format : nil
    }
}
