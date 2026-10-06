import Foundation
import StudioShellCore

// Pins the web view's navigation allow-list and media-capture rule (SW-SEC-01).
@MainActor
func navigationPolicyTests(_ t: Harness) async {
    let location = StudioLocation(address: "https://studio.example.test", tenantSlug: "acme")!
    func decide(_ text: String, main: Bool = true, at: StudioLocation? = location) -> NavigationDecision {
        NavigationPolicy.decide(url: URL(string: text), isMainFrame: main, location: at)
    }

    await t.test("Studio's own origin is allowed; a main-frame page starts a new generation") {
        t.expectEqual(decide("https://studio.example.test/t/acme/p/interview/live"), .allow(startsNewPage: true))
        t.expectEqual(decide("https://studio.example.test/t/acme/p/interview/live", main: false), .allow(startsNewPage: false))
    }

    await t.test("only the exact scheme, host and port are Studio") {
        for other in [
            "http://studio.example.test/", "https://studio.example.test:8443/", "https://studio.example.test.evil.test/",
            "https://evil.test/", "https://sub.studio.example.test/",
        ] {
            t.expectEqual(decide(other), .openExternally, "\(other) must leave the web view")
        }
        t.expectEqual(decide("https://STUDIO.example.test:443/x"), .allow(startsNewPage: true), "default port and case")
    }

    await t.test("Studio's sign-in pages and login providers start the native sign-in and are cancelled") {
        t.expectEqual(decide("https://studio.example.test/sign-in"), .showSignIn)
        t.expectEqual(decide("https://studio.example.test/api/auth/signin/google"), .showSignIn)
        t.expectEqual(decide("https://accounts.google.com/o/oauth2/v2/auth"), .showSignIn)
        t.expectEqual(decide("https://www.linkedin.com/oauth/v2/authorization"), .showSignIn)
        // Only a main-frame navigation counts; a subframe falls through to the origin rules.
        t.expectEqual(decide("https://accounts.google.com/o/oauth2/v2/auth", main: false), .openExternally)
        t.expectEqual(decide("https://studio.example.test/sign-in", main: false), .allow(startsNewPage: false))
        // A look-alike is just another site.
        t.expectEqual(decide("https://accounts.google.com.evil.test/"), .openExternally)
        t.expectEqual(decide("http://accounts.google.com/"), .openExternally)
    }

    await t.test("the built-in signed-out screen's start link asks for sign-in, in any frame") {
        t.expectEqual(decide("omnitech-studio://signin-start"), .requestSignIn)
        t.expectEqual(decide("omnitech-studio://signin-start", main: false), .requestSignIn)
        t.expectEqual(decide("omnitech-studio://signin-start", at: nil), .requestSignIn, "needs no location")
        // The fallback screen's second button: changing the connection, which needs no
        // location either (the saved one may be what is wrong), main frame or not.
        t.expectEqual(decide("omnitech-studio://change-connection"), .requestChangeConnection)
        t.expectEqual(decide("omnitech-studio://change-connection", main: false), .requestChangeConnection)
        t.expectEqual(decide("omnitech-studio://change-connection", at: nil), .requestChangeConnection, "needs no location")
        t.expectEqual(decide("omnitech-studio://change-connection/extra"), .openExternally)
        t.expectEqual(decide("omnitech-studio://change-connection?x=1"), .openExternally)
        t.expectEqual(decide("omnitech-studio://signin-start/extra"), .openExternally)
        t.expectEqual(decide("omnitech-studio://signin-start?x=1"), .openExternally)
        t.expectEqual(decide("omnitech-studio://signin"), .openExternally, "the callback is not the start link")
    }

    await t.test("about: is allowed; only a main-frame page starts a new generation") {
        t.expectEqual(decide("about:blank"), .allow(startsNewPage: true))
        t.expectEqual(decide("about:blank", main: false), .allow(startsNewPage: false))
    }

    await t.test("with no Studio location configured nothing but about: and the start link is allowed") {
        t.expectEqual(decide("https://studio.example.test/", at: nil), .openExternally)
        t.expectEqual(decide("https://accounts.google.com/", at: nil), .openExternally)
        t.expectEqual(decide("about:blank", at: nil), .openExternally)
    }

    await t.test("a request with no URL is cancelled") {
        t.expectEqual(NavigationPolicy.decide(url: nil, isMainFrame: true, location: location), .cancel)
    }

    await t.test("media capture is granted only to Studio's origin in the main frame") {
        func allowed(_ scheme: String, _ host: String, _ port: Int, main: Bool = true, at: StudioLocation?? = .none) -> Bool {
            NavigationPolicy.mediaCaptureAllowed(
                originScheme: scheme, host: host, port: port, isMainFrame: main, location: at ?? location)
        }
        t.expect(allowed("https", "studio.example.test", 0), "WebKit reports port 0 for the default port")
        t.expect(allowed("https", "studio.example.test", 443))
        t.expect(!allowed("https", "studio.example.test", 0, main: false), "subframes are refused")
        t.expect(!allowed("https", "evil.test", 0), "other site")
        t.expect(!allowed("http", "studio.example.test", 0), "other scheme")
        t.expect(!allowed("https", "studio.example.test", 8443), "other port")
        t.expect(!allowed("https", "studio.example.test.evil.test", 0), "look-alike host")
        t.expect(!allowed("https", "studio.example.test", 0, at: .some(nil)), "no location, no capture")
        let local = StudioLocation(address: "http://127.0.0.1:3100", tenantSlug: "local")!
        t.expect(allowed("http", "127.0.0.1", 3100, at: local))
        t.expect(!allowed("http", "127.0.0.1", 3101, at: local))
        t.expect(!allowed("http", "localhost", 3100, at: local))
    }

    // The shell cancels a navigation on purpose (the sign-in redirect, a button's
    // link) and WebKit reports it as a failed load. Only a cancellation is
    // ignored; a real failure (the server is down) still shows the fallback. WebKit
    // reports a policy-cancelled load as WebKitErrorDomain 102 ("frame load
    // interrupted"), not as NSURLErrorCancelled: treating only the second as a
    // cancel put "Can't reach Studio" over the shell's own sign-in panel.
    await t.test("the shell's own cancelled navigations are not failures, real failures are") {
        t.expect(NavigationFailure.isDeliberateCancel(domain: "NSURLErrorDomain", code: -999), "URL loading cancelled")
        t.expect(NavigationFailure.isDeliberateCancel(domain: "WebKitErrorDomain", code: 102), "frame load interrupted by a policy change")
        t.expect(!NavigationFailure.isDeliberateCancel(domain: "NSURLErrorDomain", code: -1004), "cannot connect to host")
        t.expect(!NavigationFailure.isDeliberateCancel(domain: "NSURLErrorDomain", code: -1001), "timed out")
        t.expect(!NavigationFailure.isDeliberateCancel(domain: "NSURLErrorDomain", code: 102), "the code alone is not enough")
        t.expect(!NavigationFailure.isDeliberateCancel(domain: "WebKitErrorDomain", code: 101), "cannot show URL")
        t.expect(!NavigationFailure.isDeliberateCancel(domain: "WebKitErrorDomain", code: -999), "the domain matters")
    }
}

