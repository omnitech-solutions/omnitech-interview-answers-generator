import Foundation

// Adapter-facing seam: the ScreenCaptureKit / AVAudioEngine adapters implement
// this; Core never touches a framework.
public protocol SourceControl {
    func start(_ source: CaptureSource)
    func stop(_ source: CaptureSource)
}

// Persists the "stopped locally" marker (a tiny local file in the adapter).
public protocol StopMarkerStore {
    func persistStoppedLocally(at time: Date) throws
}

// [SAFETY] LOCAL STOP (rule:offline-local-stop). The person's stop never waits on
// Studio: it is synchronous, uses no network and cannot be refused. Order:
// make the state visible, stop every source, zero the audio, persist the
// marker, and only then queue the best-effort notices. A local stop is final
// for the run; nothing in ControlPull can resume it.
public final class StopController {
    private let machine: CompanionStateMachine
    private let sources: SourceControl
    private let buffers: [AudioRingBuffer]
    private let marker: StopMarkerStore
    private let outbox: Outbox
    private let factory: ObservationFactory
    private let clock: WallClock
    public private(set) var markerPersisted = false

    public init(
        machine: CompanionStateMachine, sources: SourceControl, buffers: [AudioRingBuffer],
        marker: StopMarkerStore, outbox: Outbox, factory: ObservationFactory, clock: WallClock
    ) {
        self.machine = machine
        self.sources = sources
        self.buffers = buffers
        self.marker = marker
        self.outbox = outbox
        self.factory = factory
        self.clock = clock
    }

    // Idempotent: a second call changes nothing.
    public func stopNow() {
        guard machine.state != .stoppedLocally else { return }
        // [STATE] Remember which sources were live before the state flips, so
        // each gets one user-stopped notice.
        let live = machine.selection.filter {
            machine.statuses[$0] == .running || machine.statuses[$0] == .pausedByStudio
        }.sorted { $0.rawValue < $1.rawValue }

        machine.stopLocally()
        for source in machine.selection { sources.stop(source) }
        for buffer in buffers { buffer.drop(reason: .stopped) }
        // A failure to write the marker never blocks or undoes the stop.
        markerPersisted = (try? marker.persistStoppedLocally(at: clock.now())) != nil

        // [SAFETY] Content still queued is dropped: after a stop only the stop
        // notice may leave this Mac. Notices are best-effort and queued, not sent here.
        outbox.discardContent()
        for source in live {
            outbox.enqueue(
                factory.make(source, .sourceDisconnected(source: source, reason: .userStopped)),
                now: clock.now())
        }
    }
}
