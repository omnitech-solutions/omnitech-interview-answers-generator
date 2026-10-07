import CaptureAdapters
import CaptureCore
import Foundation
import StudioShellCore

private final class MemoryCredentials: CredentialStore {
    var value: String?
    func load() throws -> String? { value }
    func save(_ credential: String) throws { value = credential }
    func delete() throws { value = nil }
}

private let credential = "asc_" + String(repeating: "A", count: 43)

private func tempPaths() -> CompanionPaths {
    CompanionPaths(
        directory: FileManager.default.temporaryDirectory
            .appendingPathComponent("studio-shell-tests-\(UUID().uuidString)", isDirectory: true))
}

@MainActor
func pairingTests(_ t: Harness) async {
    await t.test("pairing stores the credential and the address, and reads them back") {
        let store = MemoryCredentials()
        let paths = tempPaths()
        defer { try? FileManager.default.removeItem(at: paths.directory) }
        let pairing = StudioPairing(credentials: store, paths: paths)
        t.expect(pairing.current() == nil, "nothing before pairing")
        let outcome = pairing.pair(address: "http://127.0.0.1:3100", tenantSlug: "local", credential: credential)
        guard case .paired(let location) = outcome else { return t.expect(false, "should pair") }
        t.expectEqual(location.tenantSlug, "local")
        t.expectEqual(store.value, credential)
        t.expectEqual(pairing.current()?.origin.absoluteString, "http://127.0.0.1:3100")
        t.expect(pairing.hasCredential())
        pairing.forget()
        t.expect(pairing.current() == nil && !pairing.hasCredential(), "forget removes both")
    }

    await t.test("the credential is optional, but a malformed one is refused before storing") {
        let store = MemoryCredentials()
        let paths = tempPaths()
        defer { try? FileManager.default.removeItem(at: paths.directory) }
        let pairing = StudioPairing(credentials: store, paths: paths)
        t.expectEqual(pairing.pair(address: "", tenantSlug: "local", credential: "asc_short"), .invalidCredential)
        t.expect(store.value == nil && pairing.current() == nil, "a refusal stores nothing")
        guard case .paired = pairing.pair(address: "", tenantSlug: "local", credential: "") else {
            return t.expect(false, "no credential still pairs")
        }
        t.expect(store.value == nil, "no credential, none stored")
    }

    await t.test("a bad address stores nothing") {
        let store = MemoryCredentials()
        let paths = tempPaths()
        let pairing = StudioPairing(credentials: store, paths: paths)
        t.expectEqual(
            pairing.pair(address: "http://studio.example.com", tenantSlug: "x", credential: credential), .invalidAddress
        )
        t.expect(store.value == nil, "nothing stored")
    }
}
