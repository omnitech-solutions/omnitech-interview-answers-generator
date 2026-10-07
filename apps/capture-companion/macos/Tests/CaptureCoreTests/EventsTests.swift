import CaptureCore
import Foundation

private final class Box: @unchecked Sendable {
    var seen: [CompanionEvent] = []
}

@MainActor
func eventsTests(_ t: Harness) async {
    await t.test("events reach the installed sink and nothing without one") {
        let box = Box()
        CompanionEvents.record(.system, "source.lost", ["source": "microphone"])
        CompanionEvents.shared.install { box.seen.append($0) }
        CompanionEvents.record(.system, "source.lost", ["source": "applicationAudio", "reason": "error"])
        CompanionEvents.shared.install(nil)
        CompanionEvents.record(.heartbeat, "heartbeat")
        t.expectEqual(
            box.seen,
            [
                CompanionEvent(
                    origin: .system, name: "source.lost", fields: ["source": "applicationAudio", "reason": "error"])
            ])
    }

    await t.test("a heartbeat carries the companion's diagnostics as codes; without them the wire is unchanged") {
        let plain = Heartbeat(sourceId: "a", sentAt: "2026-10-03T10:00:00Z", capturing: true)
        t.expect(
            !(String(bytes: IngestMessage.heartbeat(plain).encoded(), encoding: .utf8) ?? "").contains("diagnostics"))
        let beat = Heartbeat(
            sourceId: "a", sentAt: "2026-10-03T10:00:00Z", capturing: false,
            diagnostics: HeartbeatDiagnostics(
                state: "sourceLost", sources: ["microphone": "running", "applicationAudio": "lost"], speechFailure: nil)
        )
        let encoded = String(bytes: IngestMessage.heartbeat(beat).encoded(), encoding: .utf8) ?? ""
        t.expect(
            encoded.contains(
                #""diagnostics":{"sources":{"applicationAudio":"lost","microphone":"running"},"state":"sourceLost"}"#),
            encoded)
    }

    await t.test("a lost source is reported with its reason, and so is a terminal state") {
        let box = Box()
        CompanionEvents.shared.install { box.seen.append($0) }
        let machine = CompanionStateMachine(selection: [.microphone])
        _ = machine.markRunning(.microphone)
        machine.markLost(.microphone, reason: .deviceLost)
        machine.stopLocally()
        CompanionEvents.shared.install(nil)
        t.expectEqual(box.seen.map(\.name), ["source.lost", "run.terminal"])
        t.expectEqual(box.seen.first?.fields["reason"], "deviceLost")
        t.expectEqual(box.seen.last?.fields["state"], "stoppedLocally")
    }

    await t.test("state: a lost source stops only itself; the others keep capturing (a revoked one stops all)") {
        let machine = CompanionStateMachine(selection: [.microphone, .applicationAudio])
        t.expect(machine.markRunning(.microphone) && machine.markRunning(.applicationAudio))
        // Application audio falls silent and its recogniser ends: the microphone still carries the session.
        machine.markLost(.applicationAudio, reason: .error)
        t.expectEqual(machine.state, .sourceLost, "the problem stays visible")
        t.expect(machine.isCapturing, "the microphone keeps capturing")
        machine.markLost(.microphone, reason: .deviceLost)
        t.expect(!machine.isCapturing, "nothing left running")
        let revoked = CompanionStateMachine(selection: [.microphone, .applicationAudio])
        t.expect(revoked.markRunning(.microphone) && revoked.markRunning(.applicationAudio))
        revoked.markLost(.microphone, reason: .permissionRevoked)
        t.expect(!revoked.isCapturing, "a revoked permission never reads as capturing")
    }
}
