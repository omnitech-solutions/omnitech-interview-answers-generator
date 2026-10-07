import Foundation
import StudioShellCore

@MainActor
func nativeSignInTests(_ t: Harness) async {
    let location = StudioLocation(address: "https://studio.example.test", tenantSlug: "acme")!
    let state = String(repeating: "s", count: 43)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    let verifier = String(repeating: "v", count: 43)
    let challenge = NativeSignIn.challenge(for: verifier)

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

    await t.test("the challenge is the unpadded base64url SHA-256 of the verifier (RFC 7636 S256)") {
        // RFC 7636 appendix B's own vector.
        t.expectEqual(
            NativeSignIn.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        t.expect(NativeSignIn.makeVerifier().count == 43)
        t.expect(NativeSignIn.makeVerifier() != NativeSignIn.makeVerifier())
    }

    await t.test("no URL the shell builds carries a session token, only nonce, challenge, code, verifier and workspace")
    {
        let start = location.nativeSignInStartURL(state: state, challenge: challenge)
        t.expectEqual(start.path, "/api/native-auth/start")
        t.expectEqual(
            URLComponents(url: start, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name), ["state", "challenge"])
        t.expect(
            !start.absoluteString.contains(verifier), "the start link, which can be copied, never holds the verifier")
        t.expect(location.isStudio(start))
        let redeem = location.nativeSignInRedeemURL(code: "abcdefghijklmnop0123", state: state, verifier: verifier)
        t.expectEqual(
            URLComponents(url: redeem, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name),
            ["code", "state", "verifier", "tenant"])
        t.expect(location.isStudio(redeem), "redemption loads inside Studio's own origin")
        t.expect(NativeSignIn.makeState().count == 43)
        t.expect(NativeSignIn.makeState() != NativeSignIn.makeState())
    }

    await t.test("an attempt accepts one callback while pending, then nothing") {
        var attempt = SignInAttempt()
        let callback = URL(string: "omnitech-studio://signin?code=abcdefghijklmnop0123")!
        t.expect(attempt.receive(callback, at: location, now: t0) == .failure(.noAttempt))
        let start = attempt.begin(at: location, now: t0, makeState: { state }, makeVerifier: { verifier })
        t.expect(start != nil)
        t.expect(attempt.isPending(now: t0))
        guard case .success(let redeem) = attempt.receive(callback, at: location, now: t0.addingTimeInterval(10)) else {
            return t.expect(false, "expected a redeem URL")
        }
        t.expect(
            redeem.absoluteString.contains("state=\(state)")
                && redeem.absoluteString.contains("code=abcdefghijklmnop0123"))
        t.expect(
            redeem.absoluteString.contains("verifier=\(verifier)"), "the shell presents its own secret on redemption")
        t.expect(
            start?.absoluteString.contains("challenge=\(challenge)") == true
                && start?.absoluteString.contains(verifier) == false)
        t.expect(
            attempt.receive(callback, at: location, now: t0.addingTimeInterval(11)) == .failure(.noAttempt), "replay")
    }

    await t.test("cancel, timeout and a malformed callback end the attempt") {
        var attempt = SignInAttempt()
        _ = attempt.begin(at: location, now: t0, makeState: { state }, makeVerifier: { verifier })
        attempt.cancel()
        t.expect(!attempt.isPending(now: t0))

        _ = attempt.begin(at: location, now: t0, makeState: { state }, makeVerifier: { verifier })
        let good = URL(string: "omnitech-studio://signin?code=abcdefghijklmnop0123")!
        t.expect(
            attempt.receive(good, at: location, now: t0.addingTimeInterval(NativeSignIn.attemptTimeout))
                == .failure(.timedOut))
        t.expect(!attempt.isPending(now: t0))

        _ = attempt.begin(at: location, now: t0, makeState: { state }, makeVerifier: { verifier })
        let bad = URL(string: "omnitech-studio://signin?token=abcdefghijklmnop0123")!
        t.expect(attempt.receive(bad, at: location, now: t0) == .failure(.malformedCallback))
        t.expect(attempt.receive(good, at: location, now: t0) == .failure(.noAttempt), "a bad callback also ends it")
    }

    await t.test("a live attempt is not stacked; a timed-out one is replaced") {
        var attempt = SignInAttempt()
        t.expect(attempt.begin(at: location, now: t0, makeState: { state }, makeVerifier: { verifier }) != nil)
        t.expect(
            attempt.begin(at: location, now: t0.addingTimeInterval(5), makeState: { state }, makeVerifier: { verifier })
                == nil)
        t.expect(
            attempt.begin(
                at: location, now: t0.addingTimeInterval(NativeSignIn.attemptTimeout + 1), makeState: { state },
                makeVerifier: { verifier }) != nil)
    }

    await t.test("a sign-in prompt shows only when Studio reports signed out and a provider exists") {
        let ok = ProbeResult.answered(status: 200)
        // Default dev user: Studio never answers 401, so signedIn is true or unknown.
        t.expectEqual(
            ConnectionRules.state(paired: true, probe: ok, signedIn: true, signInAvailable: false), .connected)
        t.expectEqual(ConnectionRules.state(paired: true, probe: ok, signedIn: nil, signInAvailable: nil), .connected)
        // Signed out but no real provider configured: no prompt.
        t.expectEqual(
            ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: false), .connected)
        t.expectEqual(
            ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: true), .signInRequired)
        t.expectEqual(
            ConnectionRules.state(paired: true, probe: ok, signedIn: false, signInAvailable: nil), .signInRequired)
    }

    await t.test(
        "the built-in fallback screen is opaque, local, names the address it tried, and acts only from its own buttons"
    ) {
        // The shell shows it when Studio's own pages cannot load, so the window is
        // never empty or see-through. It names the address that failed and offers
        // a retry and a way to change the connection: without the second, a
        // stale address was a dead end (the saved port had moved).
        let tried = "http://127.0.0.1:3100"
        let html = SignedOutScreen.html(address: tried)
        t.expect(html.contains("Can’t reach Studio"), "says what is wrong")
        t.expect(html.contains(tried), "names the address it tried, as text")
        t.expect(html.contains("href=\"\(SignedOutScreen.startURL.absoluteString)\""), "Try again is the start link")
        t.expect(
            html.contains("href=\"\(SignedOutScreen.changeConnectionURL.absoluteString)\""),
            "Change connection is its own link")
        t.expect(html.contains("background:#"), "an opaque background of its own")
        t.expect(
            !html.contains("src=") && !html.contains("href=\"http"), "loads nothing and links nowhere on the network")
        t.expect(!html.contains("<script"), "needs no script")
        // A hostile address can never become markup.
        let hostile = SignedOutScreen.html(address: "http://x\"><script>alert(1)</script>")
        t.expect(!hostile.contains("<script"), "the address is escaped")
        t.expect(SignedOutScreen.isStart(SignedOutScreen.startURL))
        t.expect(SignedOutScreen.isChangeConnection(SignedOutScreen.changeConnectionURL))
        for other in [
            "omnitech-studio://signin?code=abcdefghijklmnop0123",  // the callback is not a start
            "omnitech-studio://signin-start?x=1", "omnitech-studio://signin-start/x",
            "omnitech-studio://u@signin-start", "https://studio.example.test/signin-start",
            "omnitech-studio://other",
        ] {
            t.expect(!SignedOutScreen.isStart(URL(string: other)!), "must not start from \(other)")
        }
        for other in [
            "omnitech-studio://change-connection?x=1", "omnitech-studio://change-connection/x",
            "omnitech-studio://u@change-connection", "https://studio.example.test/change-connection",
            "omnitech-studio://signin-start", "omnitech-studio://signin?code=abcdefghijklmnop0123",
        ] {
            t.expect(
                !SignedOutScreen.isChangeConnection(URL(string: other)!), "must not change the connection from \(other)"
            )
        }
    }

    await t.test("the chosen provider rides the start link beside the nonce, and nothing else") {
        let google = location.nativeSignInStartURL(state: state, challenge: challenge, provider: .google)
        t.expectEqual(
            URLComponents(url: google, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name),
            ["state", "challenge", "provider"])
        t.expect(google.absoluteString.hasSuffix("provider=google"))
        t.expect(
            location.nativeSignInStartURL(state: state, challenge: challenge, provider: .linkedin).absoluteString
                .hasSuffix("provider=linkedin"))
        t.expectEqual(SignInProvider.allCases.map(\.rawValue), ["google", "linkedin"])
    }

    await t.test("a waiting attempt names its provider and link for reopen and copy, until it ends") {
        var attempt = SignInAttempt()
        t.expect(attempt.waiting(now: t0) == nil, "nothing waiting before a start")
        let url = attempt.begin(at: location, now: t0, provider: .linkedin) { state }
        let waiting = attempt.waiting(now: t0.addingTimeInterval(30))
        t.expectEqual(waiting?.provider, .linkedin)
        t.expectEqual(waiting?.url, url)
        t.expect(waiting?.url.absoluteString.contains("code=") == false, "the link holds no code")
        t.expect(attempt.waiting(now: t0.addingTimeInterval(NativeSignIn.attemptTimeout)) == nil, "gone at the limit")
        attempt.cancel()
        t.expect(attempt.waiting(now: t0) == nil, "gone after a cancel")
    }

    await t.test("the sign-in panel is Studio's own public page, with the workspace and the reason only") {
        let plain = location.signInPanelURL()
        t.expectEqual(plain.path, "/native/sign-in")
        t.expectEqual(URLComponents(url: plain, resolvingAgainstBaseURL: false)?.queryItems?.map(\.name), ["tenant"])
        t.expect(location.isSignInPanel(plain))
        t.expect(location.signInPanelURL(notice: .expired).absoluteString.hasSuffix("notice=expired"))
        t.expect(location.signInPanelURL(notice: .signedOut).absoluteString.hasSuffix("notice=signed-out"))
        t.expect(!location.isSignInPanel(URL(string: "https://evil.test/native/sign-in")!))
        t.expect(!location.isSignInPanel(URL(string: "https://studio.example.test/native/other")!))
        t.expect(location.isStudio(plain), "the web view may load it")
    }

    await t.test("the account state the panel hears is a closed name, with the provider only while waiting") {
        t.expect(AccountState.idle.wire["phase"] as? String == "idle")
        t.expect(AccountState.idle.wire["provider"] == nil)
        t.expect(AccountState.timedOut.wire["phase"] as? String == "timed-out")
        let waiting = AccountState.waiting(.google).wire
        t.expect(waiting["phase"] as? String == "waiting" && waiting["provider"] as? String == "google")
        let script = HostBridgeScript.emitAccountState(.waiting(.linkedin))
        t.expect(script.contains("\"phase\":\"waiting\"") && script.contains("\"provider\":\"linkedin\""))
        t.expect(!script.contains("http") && !script.contains("code"), "no address or code in the event")
    }

    await t.test("the menu-bar menu offers Sign in only when signed out, and Sign out only while someone is signed in")
    {
        t.expect(StatusMenuRules.showsSignIn(.signInRequired))
        for other: ConnectionState in [.notPaired, .connecting, .connected, .unreachable] {
            t.expect(!StatusMenuRules.showsSignIn(other), "no sign-in prompt for \(other)")
        }
        t.expect(StatusMenuRules.signOutEnabled(paired: true, signedIn: true))
        t.expect(!StatusMenuRules.signOutEnabled(paired: true, signedIn: false), "nothing to sign out of")
        t.expect(!StatusMenuRules.signOutEnabled(paired: true, signedIn: nil), "not known yet")
        t.expect(!StatusMenuRules.signOutEnabled(paired: false, signedIn: true), "no Studio to sign out of")
    }
}
