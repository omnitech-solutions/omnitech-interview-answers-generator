import Foundation
import StudioShellCore

@MainActor
func stateTests(_ t: Harness) async {
    await t.test("connection state follows pairing and Studio's probe") {
        t.expectEqual(ConnectionRules.state(paired: false, probe: .answered(status: 200)), .notPaired)
        t.expectEqual(ConnectionRules.state(paired: true, probe: nil), .connecting)
        t.expectEqual(ConnectionRules.state(paired: true, probe: .answered(status: 200)), .connected)
        t.expectEqual(ConnectionRules.state(paired: true, probe: .answered(status: 404)), .unreachable)
        t.expectEqual(ConnectionRules.state(paired: true, probe: .noAnswer), .unreachable)
    }

    await t.test("the window states that it is visible in screen shares") {
        t.expectEqual(VisibilityTruth.line, "Visible window · shows in screen shares")
    }

    await t.test("session summaries parse to menu rows with no content") {
        let list = """
        {"sessions":[
          {"id":"3f1c1e0a-5b7d-4c53-9a53-0d6a6a1d2b11","status":"active","createdAt":"2026-10-03T14:03:00.000Z"},
          {"id":"4f1c1e0a-5b7d-4c53-9a53-0d6a6a1d2b11","status":"ended","createdAt":"2026-10-03T10:00:00.000Z"},
          {"id":"not-a-uuid","status":"active"},
          {"id":"5f1c1e0a-5b7d-4c53-9a53-0d6a6a1d2b11","status":"paused","createdAt":"2026-10-03T13:00:00.000Z"}
        ],"nextCursor":null}
        """
        let choices = SessionChoices.parseList(list)
        t.expectEqual(choices.map(\.status), ["active", "paused"], "open sessions only, malformed dropped")
        t.expect(choices[1].isPaused)
        t.expect(choices[0].menuTitle(timeZone: TimeZone(identifier: "UTC")!).hasPrefix("Live · 14:03"))
        t.expectEqual(SessionChoices.parseList("nonsense"), [])
        t.expectEqual(SessionChoices.parseCurrent(#"{"session":{"id":"3f1c1e0a-5b7d-4c53-9a53-0d6a6a1d2b11","status":"paused"}}"#)?.isPaused, true)
        t.expectEqual(SessionChoices.controlBody(pause: true), #"{"version":1,"kind":"session.control","action":"pause"}"#)
        t.expectEqual(SessionChoices.controlBody(pause: false), #"{"version":1,"kind":"session.control","action":"resume"}"#)
    }

    await t.test("hotkeys are distinct and need no extra permission combination") {
        let keys = HotkeyBinding.all
        t.expectEqual(Set(keys.map(\.keyCode)).count, keys.count)
        t.expectEqual(HotkeyBinding.optionShift, 0x0A00)
        t.expectEqual(keys.first { $0.action == .captureAnalyze }?.label, "⌥⇧A")
    }
}
