import StudioShellCore

@MainActor
func browserFocusTests(_ t: Harness) async {
    await t.test("capture is allowed only while Chrome or Safari is in front") {
        t.expect(BrowserFocus.allows(bundleId: "com.google.Chrome"))
        t.expect(BrowserFocus.allows(bundleId: "com.apple.Safari"))
        t.expect(BrowserFocus.allows(bundleId: "com.google.Chrome.app.abcdef"))
        t.expect(!BrowserFocus.allows(bundleId: "com.anthropic.claudefordesktop"))
        t.expect(!BrowserFocus.allows(bundleId: "com.apple.Terminal"))
        t.expect(!BrowserFocus.allows(bundleId: nil))
    }
}
