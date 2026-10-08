import CaptureAdapters
import Foundation

private final class Owner {}
private final class Woken: @unchecked Sendable {
    var count = 0
}

// macOS runs one on-device recognition task per process: the microphone's and
// the application audio's transcriber take turns through this slot.
@MainActor
func recognitionSlotTests(_ t: Harness) async {
    await t.test("recognition slot: one holder at a time; the other is woken once when it frees") {
        let slot = RecognitionSlot()
        let mic = Owner()
        let app = Owner()
        let woken = Woken()
        t.expect(slot.acquire(ObjectIdentifier(mic)) {}, "the first asker holds it")
        t.expect(slot.acquire(ObjectIdentifier(mic)) {}, "asking again while holding is still held")
        t.expect(!slot.acquire(ObjectIdentifier(app)) { woken.count += 1 }, "the second asker waits")
        t.expect(!slot.acquire(ObjectIdentifier(app)) { woken.count += 10 }, "asking again does not queue twice")
        t.expectEqual(woken.count, 0)
        slot.release(ObjectIdentifier(mic))
        t.expectEqual(woken.count, 1, "woken exactly once, by its first registration")
        t.expect(slot.acquire(ObjectIdentifier(app)) {}, "and can take the slot now")
        t.expect(!slot.acquire(ObjectIdentifier(mic)) { woken.count += 100 }, "the first now waits its turn")
    }

    await t.test("recognition slot: a waiter that gives up is not woken; releasing without holding frees nothing") {
        let slot = RecognitionSlot()
        let mic = Owner()
        let app = Owner()
        let woken = Woken()
        t.expect(slot.acquire(ObjectIdentifier(mic)) {})
        t.expect(!slot.acquire(ObjectIdentifier(app)) { woken.count += 1 })
        // The waiter stops (a stop or pause): it leaves the queue and the holder keeps the slot.
        slot.release(ObjectIdentifier(app))
        t.expect(!slot.acquire(ObjectIdentifier(app)) { woken.count += 1 }, "still held by the first")
        slot.release(ObjectIdentifier(app))
        slot.release(ObjectIdentifier(mic))
        t.expectEqual(woken.count, 0, "nobody was waiting any more")
        t.expect(slot.acquire(ObjectIdentifier(app)) {}, "free again")
    }
}
