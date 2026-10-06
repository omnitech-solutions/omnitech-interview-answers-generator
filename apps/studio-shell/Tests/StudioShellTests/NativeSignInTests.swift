import Foundation
import StudioShellCore

@MainActor
func nativeSignInTests(_ t: Harness) async {
    let location = StudioLocation(address: "https://studio.example.test", tenantSlug: "acme")!
    let state = String(repeating: "s", count: 43)
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    await t.test("callback parsing accepts only scheme://signin?code=<code>") {
        let ok = URL(string: "omnitech-studio://signin?code=abcdefghijklmnop_-ABCDEFGHIJ0123")!
        t.expectEqual(NativeSignIn.parseCallback(ok), "abcdefghijklmnop_-ABCDEFGHIJ0123")
        for bad in [
            "omnitech-studio://signin", "omnitech-studio://signin?code=short",
            "omnitech-studio://signin?code=abcdefghijklmnop0123&token=x",
            "omnitech-studio://signin?token=abcdefghijklmnop0123",
            "omnitech-studio://other?code=abcdefghijklmnop0123",
            "https://studio.example.test/signin?code=abcdefghijklmnop0123",
            "omnitech-studio://u@signin?code=abcdefghijklmnop0123",
            "omnitech-studio://signin?code=abcdefghijklmnop0123#frag",
            "omnitech-studio://signin/x?code=abcdefghijklmnop0123",
            "omnitech-studio://signin?code=abcdefghijklmnop01%2F23",
        ] {
            t.expect(NativeSignIn.parseCallback(URL(string: bad)!) == nil, "must reject \(bad)")
        }
    }

    await t.test("only Studio's sign-in pages and known provider hosts start the round trip") {
        t.expect(location.isSignInPage(URL(string: "https://studio.example.test/sign-in")!))
        t.expect(!location.isSignInPage(URL(string: "https://evil.test/sign-in")!))
        t.expect(!location.isSignInPage(URL(string: "https://studio.example.test/t/acme")!))
        t.expect(location.isLoginProvider(URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!))
        t.expect(location.isLoginProvider(URL(string: "https://www.linkedin.com/oauth/v2/authorization")!))
        t.expect(!location.isLoginProvider(URL(string: "http://accounts.google.com/")!))
        t.expect(!location.isLoginProvider(URL(string: "https://accounts.google.com.evil.test/")!))
        t.expect(!location.isLoginProvider(URL(string: "https://example.com/")!))
    }

    await t.test("no URL the shell builds carries a session token, only nonce, code and workspace") {
        let start = location.nativeSignInStartURL(state: state)
        t.expectEqual(start.path, "/api/native-auth/start")
        t.expectEqual(URLComponents(url: start, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name), ["state"])
        t.expect(location.isStudio(start))
        let redeem = location.nativeSignInRedeemURL(code: "abcdefghijklmnop0123", state: state)
        t.expectEqual(
            URLComponents(url: redeem, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name), ["code", "state", "tenant"])
        t.expect(location.isStudio(redeem), "redemption loads inside Studio's own origin")
        t.expect(NativeSignIn.makeState().count == 43)
        t.expect(NativeSignIn.makeState() != NativeSignIn.makeState())
    }

    await t.test("an attempt accepts one callback while pending, then nothing") {
        var attempt = SignInAttempt()
        let callback = URL(string: "omnitech-studio://signin?code=abcdefghijklmnop0123")!
        t.expect(attempt.receive(callback, at: location, now: t0) == .failure(.noAttempt))
        let start = attempt.begin(at: location, now: t0) { state }
        t.expect(start != nil)
        t.expect(attempt.isPending(now: t0))
        guard case .success(let redeem) = attempt.receive(callback, at: location, now: t0.addingTimeInterval(10)) else {
            return t.expect(false, "expected a redeem URL")
        }
        t.expect(redeem.absoluteString.contains("state=\(state)") && redeem.absoluteString.contains("code=abcdefghijklmnop0123"))
        t.expect(attempt.receive(callback, at: location, now: t0.addingTimeInterval(11)) == .failure(.noAttempt), "replay")
    }

    await t.test("cancel, timeout and a malformed callback end the attempt") {
        var attempt = SignInAttempt()
        _ = attempt.begin(at: location, now: t0) { state }
        attempt.cancel()
        t.expect(!attempt.isPending(now: t0))

        _ = attempt.begin(at: location, now: t0) { state }
        let good = URL(string: "omnitech-studio://signin?code=abcdefghijklmnop0123")!
        t.expect(
            attempt.receive(good, at: location, now: t0.addingTimeInterval(NativeSignIn.attemptTimeout)) == .failure(.timedOut))
        t.expect(!attempt.isPending(now: t0))

        _ = attempt.begin(at: location, now: t0) { state }
        let bad = URL(string: "omnitech-studio://signin?token=abcdefghijklmnop0123")!
        t.expect(attempt.receive(bad, at: location, now: t0) == .failure(.malformedCallback))
        t.expect(attempt.receive(good, at: location, now: t0) == .failure(.noAttempt), "a bad callback also ends it")
    }

    await t.test("a live attempt is not stacked; a timed-out one is replaced") {
        var attempt = SignInAttempt()
        t.expect(attempt.begin(at: location, now: t0) { state } != nil)
        t.expect(attempt.begin(at: location, now: t0.addingTimeInterval(5)) { state } == nil)
        t.expect(
            attempt.begin(at: location, now: t0.addingTimeInterval(NativeSignIn.attemptTimeout + 1)) { state } != nil)
    }

    await t.test("a sign-in prompt shows only when Studio reports signed out and a provider exists") {
        let ok = ProbeResult.answered(status: 200)
        // Default dev user: Studio never answers 401, so signedIn is true or unknown.
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: true, signInAvailable: false), .connected)
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: nil, signInAvailable: nil), .connected)
        // Signed out but no real provider configured: no prompt.
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: false), .connected)
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: true), .signInRequired)
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: nil), .signInRequired)
    }

    await t.test("the built-in signed-out screen is opaque, local, and starts sign-in only from its own button") {
        // The shell shows it when a page is refused for want of a session, so the window is
        // never empty or see-through: a plain screen with one button.
        let html = SignedOutScreen.html
        t.expect(html.contains("Sign in to Studio"), "says what to do")
        t.expect(html.contains(SignedOutScreen.startURL.absoluteString), "its button is the start link")
        t.expect(html.contains("background:#"), "an opaque background of its own")
        t.expect(!html.contains("http://") && !html.contains("https://"), "loads nothing from anywhere")
        t.expect(!html.contains("<script"), "needs no script")
        t.expect(SignedOutScreen.isStart(SignedOutScreen.startURL))
        for other in [
            "omnitech-studio://signin?code=abcdefghijklmnop0123",  // the callback is not a start
            "omnitech-studio://signin-start?x=1", "omnitech-studio://signin-start/x",
            "omnitech-studio://u@signin-start", "https://studio.example.test/signin-start",
            "omnitech-studio://other",
        ] {
            t.expect(!SignedOutScreen.isStart(URL(string: other)!), "must not start from \(other)")
        }
    }
}
