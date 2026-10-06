import Foundation

// [DOMAIN] Which Keychain account an app stores its session credential under.
// macOS lets only the code identity that made a Keychain item delete or replace it.
// A Developer ID build keeps one identity across versions (its team), so it keeps one
// account. An ad-hoc build is a new identity on every build, so it gets an account of
// its own: a rebuilt app then never meets an item an older build left behind (which it
// could neither read nor delete, so the engine would refuse to start, "store-failed").
// Old items of other builds are unreadable orphans and harmless.
public enum CredentialAccount {
    public static func name(base: String, teamIdentifier: String?, codeHash: Data?) -> String {
        if let team = teamIdentifier, !team.isEmpty {
            return "\(base).team-\(safe(team))"
        }
        if let hash = codeHash, !hash.isEmpty {
            let hex = hash.prefix(8).map { String(format: "%02x", $0) }.joined()
            return "\(base).build-\(hex)"
        }
        return base
    }

    // Only letters and digits survive: the tag never changes what the name means.
    private static func safe(_ text: String) -> String {
        String(text.filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
    }
}
