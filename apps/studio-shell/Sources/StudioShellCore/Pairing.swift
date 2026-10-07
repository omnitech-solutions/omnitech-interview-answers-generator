import CaptureAdapters
import CaptureCore
import Foundation

public enum PairingOutcome: Equatable, Sendable {
    case paired(StudioLocation)
    case invalidAddress
    case invalidCredential
    case storeFailed
}

// [DOMAIN] Pairing is the capture companion's own mechanism: the address,
// workspace slug and (optionally) the credential the Studio pairing panel shows.
// The shell stores them where the companion does (Keychain and its pairing
// record), so one pairing serves both and nothing is invented. A session
// credential is per-session and expires, so the shell does not require one: the
// address and workspace are what it needs to open Studio.
//
// [SAFETY] The shell checks only that a credential is well formed. It never
// sends it: capture reaches Studio through the page, with the person's own
// sign-in (ADR-0018). The credential is never logged or shown.
public struct StudioPairing {
    private let credentials: CredentialStore
    private let paths: CompanionPaths

    public init(credentials: CredentialStore, paths: CompanionPaths) {
        self.credentials = credentials
        self.paths = paths
    }

    public func pair(address: String, tenantSlug: String, credential: String) -> PairingOutcome {
        guard let location = StudioLocation(address: address, tenantSlug: tenantSlug) else { return .invalidAddress }
        let trimmed = credential.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty || Endpoint.isCredentialShape(trimmed) else { return .invalidCredential }
        do {
            if !trimmed.isEmpty { try credentials.save(trimmed) }
            try PairingRecord(studioAddress: location.origin.absoluteString, tenantSlug: location.tenantSlug)
                .save(to: paths)
        } catch {
            return .storeFailed
        }
        return .paired(location)
    }

    // The saved location, if the person has paired.
    public func current() -> StudioLocation? {
        guard let record = PairingRecord.load(from: paths) else { return nil }
        return StudioLocation(address: record.studioAddress, tenantSlug: record.tenantSlug)
    }

    public func hasCredential() -> Bool { (try? credentials.load()) != nil }

    public func forget() {
        try? credentials.delete()
        try? FileManager.default.removeItem(at: paths.pairing)
    }
}
