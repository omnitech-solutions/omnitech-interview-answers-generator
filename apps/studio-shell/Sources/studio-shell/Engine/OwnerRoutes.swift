import CaptureCore
import Foundation

// [DOMAIN] The owner routes Studio already serves to its own Live page: issue or
// renew a session's pairing credential, and revoke it. The engine
// calls them as the signed-in person; Studio decides everything. The protocol
// exists because there are two implementations: the web view (production) and a
// fake (tests).
public enum OwnerRouteFailure: Error, Equatable, Sendable {
    // 401/403: the web view is not signed in (yet).
    case signedOut
    // 404/409: no such open session any more, or it can no longer take a credential.
    case gone
    // The page is not at Studio, or Studio did not answer sensibly.
    case unreachable
}

@MainActor
public protocol OwnerRoutes: AnyObject {
    func issueCredential(sessionId: String) async -> Result<IssuedCredential, OwnerRouteFailure>
    // True when Studio confirmed the revocation.
    func revokeCredential(sessionId: String) async -> Bool
}

// [DOMAIN] When to renew. Studio caps a credential at two hours and a renewal
// replaces the previous one, so the engine renews well before the cap instead
// of waiting for a refusal. Pure and clock-driven so it is tested without time.
public struct CredentialLifecycle {
    // Renew when this little lifetime remains.
    public static let renewLeadSeconds: Double = 20 * 60
    // A credential that expires with a nearly-over session must not trigger a
    // renewal storm: never renew more often than this.
    public static let minimumSpacingSeconds: Double = 60

    public private(set) var expiresAt: Date?
    private var lastIssuedAt: Date?
    private var nextAttemptAt: Date?
    private var backoff: Backoff

    public init(random: @escaping () -> Double) {
        backoff = Backoff(baseSeconds: 2, capSeconds: 60, random: random)
    }

    public mutating func issued(expiresAt: Date, at now: Date) {
        self.expiresAt = expiresAt
        lastIssuedAt = now
        nextAttemptAt = nil
        backoff.reset()
    }

    public mutating func forget() {
        expiresAt = nil
        lastIssuedAt = nil
        nextAttemptAt = nil
        backoff.reset()
    }

    public func shouldRenew(now: Date) -> Bool {
        guard let expiresAt else { return false }
        if let nextAttemptAt, now < nextAttemptAt { return false }
        if let lastIssuedAt, now.timeIntervalSince(lastIssuedAt) < Self.minimumSpacingSeconds { return false }
        return now >= expiresAt.addingTimeInterval(-Self.renewLeadSeconds)
    }

    // A failed renewal retries on a growing, jittered delay, never past expiry.
    public mutating func renewalFailed(now: Date) {
        nextAttemptAt = now.addingTimeInterval(backoff.nextDelay())
    }
}
