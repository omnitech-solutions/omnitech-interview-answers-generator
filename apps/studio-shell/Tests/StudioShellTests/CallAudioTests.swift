import CaptureAdapters
import CaptureCore
import Foundation
import StudioShellCore

private final class MemoryStore: SettingsStore {
    var values: [String: String] = [:]
    func string(forKey key: String) -> String? { values[key] }
    func set(_ value: String?, forKey key: String) { values[key] = value }
}

@MainActor
func callAudioTests(_ t: Harness) async {
    await t.test("the call-audio preference defaults to ScreenCaptureKit, persists, and ignores junk") {
        let store = MemoryStore()
        let prefs = ShellPrefs(store: store)
        t.expectEqual(prefs.callAudio, .screenCaptureKit)
        prefs.callAudio = .processTap
        t.expectEqual(store.values["audio.callSource"], "processTap")
        t.expectEqual(ShellPrefs(store: store).callAudio, .processTap)
        store.values["audio.callSource"] = "everything"
        t.expectEqual(prefs.callAudio, .screenCaptureKit)
    }

    await t.test("the call's audio follows Screen Recording only while ScreenCaptureKit carries it") {
        func state(
            _ selected: CallAudioSource, _ active: CallAudioSource, _ evidence: TapEvidence,
            _ screen: StudioShellCore.PermissionState
        ) -> StudioShellCore.PermissionState {
            CallAudioReport(
                selected: selected, active: active, evidence: evidence, screen: screen, tapSupported: true
            ).state
        }
        // The default: exactly the screen's state, as before.
        t.expectEqual(state(.screenCaptureKit, .screenCaptureKit, .untried, .denied), .denied)
        t.expectEqual(state(.screenCaptureKit, .screenCaptureKit, .untried, .granted), .granted)
        // The tap: never "needs Screen Recording", and never "allowed" before sound proved it.
        t.expectEqual(state(.processTap, .processTap, .untried, .denied), .undetermined)
        t.expectEqual(state(.processTap, .processTap, .runningSilent, .denied), .undetermined)
        t.expectEqual(state(.processTap, .processTap, .untried, .granted), .undetermined)
        t.expectEqual(state(.processTap, .processTap, .heardSound, .denied), .granted)
        // The tap chosen but ScreenCaptureKit carrying it (fallback): the screen's state again.
        t.expectEqual(state(.processTap, .screenCaptureKit, .failed(.noBuffers), .denied), .denied)
        t.expectEqual(state(.processTap, .screenCaptureKit, .failed(.osTooOld), .granted), .granted)
    }

    await t.test("setCallAudio takes exactly one of the two capture names") {
        func call(_ params: [String: Any]) -> Result<HostCall, HostCallError> {
            HostCallDecoder.decode(["v": HostBridge.version, "method": "setCallAudio", "params": params])
        }
        t.expectEqual(call(["source": "processTap"]), .success(.setCallAudio(.processTap)))
        t.expectEqual(call(["source": "screenCaptureKit"]), .success(.setCallAudio(.screenCaptureKit)))
        for bad: [String: Any] in [
            [:], ["source": "tap"], ["source": 1], ["source": "ProcessTap"], ["source": "processTap", "mute": true],
        ] {
            t.expectEqual(call(bad), .failure(.invalidParameters), "\(bad) is refused")
        }
    }

    await t.test("the permission reply adds the call-audio report as closed names") {
        let report = CallAudioReport(
            selected: .processTap, active: .processTap, evidence: .runningSilent, screen: .denied,
            tapSupported: true)
        let reply = HostReply.permissions(microphone: .granted, screen: .denied, callAudio: report)
        t.expectEqual(reply.count, 3)
        let callAudio = reply["callAudio"] as? [String: Any] ?? [:]
        t.expectEqual(callAudio.count, 4)
        t.expect(callAudio["selected"] as? String == "processTap" && callAudio["active"] as? String == "processTap")
        t.expect(callAudio["permission"] as? String == "undetermined" && callAudio["tapSupported"] as? Bool == true)
    }

    await t.test("on this Mac the default preference is carried by ScreenCaptureKit with no reason") {
        let carrier = ApplicationAudioSource.carrier(for: .screenCaptureKit)
        t.expectEqual(carrier.source, .screenCaptureKit)
        t.expect(carrier.reason == nil)
    }
}
