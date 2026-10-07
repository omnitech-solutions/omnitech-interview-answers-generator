import CaptureCore
import Foundation

// A rebuilt, ad-hoc-signed app has a different code identity each time, and macOS
// will not let it delete or replace a Keychain item an older build made (the engine
// then reports "store-failed"). The shell therefore scopes its item to its signature.
@MainActor
func credentialAccountTests(_ t: Harness) async {
    await t.test("an ad-hoc build gets its own account: a rebuild never meets an older build's item") {
        let one = CredentialAccount.name(
            base: "session-ingest-credential", teamIdentifier: nil, codeHash: Data([1, 2, 3, 4, 5, 6, 7]))
        let two = CredentialAccount.name(
            base: "session-ingest-credential", teamIdentifier: nil, codeHash: Data([9, 9, 9, 9, 9, 9, 9]))
        t.expect(one != two)
        t.expectEqual(one, "session-ingest-credential.build-01020304050607")
    }

    await t.test("a team-signed build keeps one account across versions") {
        let old = CredentialAccount.name(
            base: "session-ingest-credential", teamIdentifier: "ABCDE12345", codeHash: Data([1, 1]))
        let new = CredentialAccount.name(
            base: "session-ingest-credential", teamIdentifier: "ABCDE12345", codeHash: Data([2, 2]))
        t.expectEqual(old, new)
        t.expectEqual(old, "session-ingest-credential.team-ABCDE12345")
    }

    await t.test("with no signing information the plain account is used (the companion command line tool)") {
        t.expectEqual(
            CredentialAccount.name(base: "session-ingest-credential", teamIdentifier: nil, codeHash: nil),
            "session-ingest-credential")
    }

    await t.test("the tag cannot carry anything but letters, digits and a dash") {
        let name = CredentialAccount.name(base: "b", teamIdentifier: "A B/C*1", codeHash: nil)
        t.expect(name.allSatisfy { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }, name)
    }
}
