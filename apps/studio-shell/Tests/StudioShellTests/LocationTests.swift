import Foundation
import StudioShellCore

private let session = "3f1c1e0a-5b7d-4c53-9a53-0d6a6a1d2b11"

@MainActor
func locationTests(_ t: Harness) async {
    await t.test("an empty address means the local default, the port `pnpm dev` and the Docker stack serve") {
        let location = StudioLocation(address: "  ", tenantSlug: "local")
        t.expectEqual(location?.origin.absoluteString, "http://127.0.0.1:3000")
    }

    await t.test("an address is an origin only; a trailing slash is fine") {
        t.expectEqual(StudioLocation(address: "https://studio.example.com/", tenantSlug: "acme")?.origin.absoluteString,
            "https://studio.example.com")
        for bad in [
            "http://studio.example.com",  // plain http off loopback
            "https://user:pw@studio.example.com", "https://studio.example.com/path",
            "https://studio.example.com?x=1", "https://studio.example.com#f", "ftp://studio.example.com",
            "not a url", "javascript:alert(1)",
        ] {
            t.expect(StudioLocation(address: bad, tenantSlug: "acme") == nil, "\(bad) should be refused")
        }
        t.expect(StudioLocation(address: "http://localhost:3100", tenantSlug: "acme") != nil, "loopback http")
        t.expect(StudioLocation(address: "http://127.0.0.1:3100", tenantSlug: "../x") == nil, "slug is checked")
    }

    await t.test("the overlay route is /t/:tenant/p/interview/live/overlay?host=native") {
        let location = StudioLocation(address: "", tenantSlug: "local")!
        t.expectEqual(location.overlayURL().absoluteString,
            "http://127.0.0.1:3000/t/local/p/interview/live/overlay?host=native")
        t.expectEqual(location.overlayURL(sessionId: session).absoluteString,
            "http://127.0.0.1:3000/t/local/p/interview/live/overlay?host=native&session=\(session)")
        // Not a session id: dropped, never put in the URL.
        t.expectEqual(location.overlayURL(sessionId: "x&host=evil").absoluteString,
            "http://127.0.0.1:3000/t/local/p/interview/live/overlay?host=native")
    }

    await t.test("the probe is the public manifest; the session API path is the frontend's") {
        let location = StudioLocation(address: "", tenantSlug: "local")!
        t.expectEqual(location.probeURL.path, "/t/local/p/interview/manifest.webmanifest")
        t.expectEqual(location.sessionsPath, "/api/interview/t/local/sessions")
    }

    await t.test("only Studio's own origin counts as Studio") {
        let location = StudioLocation(address: "http://127.0.0.1:3100", tenantSlug: "local")!
        t.expect(location.isStudio(URL(string: "http://127.0.0.1:3100/t/local/p/interview/live")!))
        t.expect(!location.isStudio(URL(string: "http://127.0.0.1:3101/")!), "other port")
        t.expect(!location.isStudio(URL(string: "https://127.0.0.1:3100/")!), "other scheme")
        t.expect(!location.isStudio(URL(string: "http://localhost:3100/")!), "other host")
        t.expect(!location.isStudio(URL(string: "https://evil.example/")!), "other site")
        t.expect(location.isStudio(scheme: "http", host: "127.0.0.1", port: 3100))
        t.expect(!location.isStudio(scheme: nil, host: "127.0.0.1", port: 3100))
    }
}
