import CaptureCore
import Foundation
import Security

public enum KeychainFailure: Error, Equatable {
    case unexpectedStatus(Int32)
}

// [SAFETY] The session credential lives only in this Mac's Keychain
// (rule:credential-storage): a generic password, readable only while the Mac is
// unlocked and never migrated to another device or synced. It is loaded into
// memory to build the Authorization header and is never logged or printed.
public final class KeychainCredentialStore: CredentialStore {
    private let service: String
    private let account: String

    public init(service: String = "com.omnitech.capture-companion", account: String = "session-ingest-credential") {
        self.service = service
        self.account = account
    }

    private var identity: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() throws -> String? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainFailure.unexpectedStatus(status)
        }
        return String(data: data, encoding: .utf8)
    }

    // Replaces any earlier credential: an owner-initiated renewal is a new paste.
    public func save(_ credential: String) throws {
        try delete()
        var item = identity
        item[kSecValueData as String] = Data(credential.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainFailure.unexpectedStatus(status) }
    }

    public func delete() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainFailure.unexpectedStatus(status)
        }
    }
}
