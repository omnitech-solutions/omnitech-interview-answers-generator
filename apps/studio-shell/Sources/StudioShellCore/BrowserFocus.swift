import Foundation

// [DOMAIN] The screen is captured only while the person is working in a
// browser (Chrome or Safari): the practice problem lives on a web page, and
// nothing else on the desktop is ever looked at. [SAFETY] Decided from the
// frontmost application's bundle id alone; no pixels are read to decide it.
public enum BrowserFocus {
    private static let exact: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary",
        "com.apple.Safari", "com.apple.SafariTechnologyPreview",
    ]

    public static func allows(bundleId: String?) -> Bool {
        guard let bundleId else { return false }
        // A Chrome-installed web app is Chrome too.
        return exact.contains(bundleId) || bundleId.hasPrefix("com.google.Chrome.app.")
    }

    public static let refusal = "no-focused-window"
}
