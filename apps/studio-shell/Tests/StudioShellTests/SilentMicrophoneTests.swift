import StudioShellEngine

// A microphone that delivers frames but only dead silence (a Bluetooth headset
// whose microphone is off) must be named, never shown as plain "Listening".
@MainActor
func silentMicrophoneTests(_ t: Harness) async {
    await t.test("a microphone that is on but dead silent is named, and only while it is listening") {
        var snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .listening], micSilent: true)
        t.expect(snapshot.hint?.hasPrefix("Your microphone is silent") == true, snapshot.hint ?? "no hint")
        t.expect(snapshot.hint?.contains("Choose another microphone") == true)
        snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .listening])
        t.expect(snapshot.hint == nil, "a live microphone needs nothing")
        snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .off], micSilent: true)
        t.expect(snapshot.hint == nil, "a microphone that is off is not 'silent'")
        // A denied permission is the first thing to fix and wins.
        snapshot = EngineSnapshot(stage: .paired, sources: [.microphone: .permissionDenied], micSilent: true)
        t.expectEqual(snapshot.hint, "Grant Microphone in System Settings › Privacy & Security.")
    }
}
