import CaptureCore
import Foundation
import StudioShellCore

private let studio = StudioLocation(address: "http://127.0.0.1:3100", tenantSlug: "local")!
private let secure = StudioLocation(address: "https://studio.example.com", tenantSlug: "local")!

private func sender(
    main: Bool = true, scheme: String? = "http", host: String? = "127.0.0.1", port: Int? = 3100, ours: Bool = true
) -> SenderFacts {
    SenderFacts(isMainFrame: main, scheme: scheme, host: host, port: port, isIntendedWebView: ours)
}

@MainActor
func bridgeTrustTests(_ t: Harness) async {
    await t.test("only the main frame of the intended web view at the exact Studio origin is trusted") {
        t.expect(BridgeTrust.accepts(sender(), location: studio))
        t.expect(!BridgeTrust.accepts(sender(main: false), location: studio), "a subframe is ignored")
        t.expect(!BridgeTrust.accepts(sender(ours: false), location: studio), "another web view is ignored")
        t.expect(!BridgeTrust.accepts(sender(), location: nil), "unpaired trusts nobody")
        t.expect(!BridgeTrust.accepts(sender(port: 3101), location: studio), "another port")
        t.expect(!BridgeTrust.accepts(sender(host: "localhost"), location: studio), "another host name")
        t.expect(!BridgeTrust.accepts(sender(host: "127.0.0.1.evil.test"), location: studio), "a look-alike host")
        t.expect(!BridgeTrust.accepts(sender(scheme: "https"), location: studio), "another scheme")
        t.expect(!BridgeTrust.accepts(sender(scheme: nil, host: nil, port: nil), location: studio))
        t.expect(!BridgeTrust.accepts(sender(scheme: "file", host: "", port: 0), location: studio))
    }

    await t.test("WebKit's port 0 means the scheme's default port") {
        t.expect(BridgeTrust.accepts(sender(scheme: "https", host: "studio.example.com", port: 0), location: secure))
        t.expect(BridgeTrust.accepts(sender(scheme: "HTTPS", host: "Studio.Example.com", port: 443), location: secure))
        t.expect(
            !BridgeTrust.accepts(sender(scheme: "https", host: "studio.example.com", port: 8443), location: secure))
        t.expect(!BridgeTrust.accepts(sender(scheme: "http", host: "studio.example.com", port: 0), location: secure))
    }

    await t.test("a navigation, sign-out or rebind outdates a ticket; a reply is dropped, not redirected") {
        let epoch = BridgeEpoch()
        let ticket = epoch.ticket()
        t.expect(epoch.isCurrent(ticket), "current until the page changes")
        epoch.advance()
        t.expect(!epoch.isCurrent(ticket), "an earlier ticket is never current again")
        let next = epoch.ticket()
        t.expect(epoch.isCurrent(next))
        t.expect(next != ticket)
    }

    await t.test("focused window is the app frontmost at receipt, and never the shell") {
        let own: Int32 = 100
        t.expectEqual(FocusSampling.sample(frontmost: 200, ownPid: own, lastOther: 300), 200)
        t.expectEqual(
            FocusSampling.sample(frontmost: own, ownPid: own, lastOther: 300), 300, "the shell is not the focus")
        t.expectEqual(FocusSampling.sample(frontmost: nil, ownPid: own, lastOther: 300), 300)
        t.expectEqual(FocusSampling.sample(frontmost: own, ownPid: own, lastOther: nil), nil, "none, never widened")
    }

    await t.test("a region is bound to the display it was defined for") {
        t.expect(DisplayBinding.allows(requested: nil, sampled: 1, current: 1), "no id: the display sampled at receipt")
        t.expect(DisplayBinding.allows(requested: 1, sampled: 1, current: 1))
        t.expect(!DisplayBinding.allows(requested: 2, sampled: 1, current: 1), "defined for another display")
        t.expect(
            !DisplayBinding.allows(requested: nil, sampled: 1, current: 2), "main display changed during the request")
        t.expect(!DisplayBinding.allows(requested: 1, sampled: 2, current: 2), "the display it named is gone")
    }

    await t.test("the bridge script exposes only the typed methods and no credential") {
        let source = HostBridgeScript.source(capabilities: HostCapability.allCases)
        for forbidden in ["asc_", "keychain", "Authorization", "credential", "fetch(", "XMLHttpRequest"] {
            t.expect(!source.lowercased().contains(forbidden.lowercased()), forbidden)
        }
        t.expectEqual(
            HostCapability.allCases.map(\.rawValue),
            [
                "capture-screen", "pin-on-top", "hotkeys", "open-external", "screen-watch", "text-recognition",
                "display-selection", "account",
            ])
    }
}
