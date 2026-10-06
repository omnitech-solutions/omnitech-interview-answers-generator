import AppKit
import StudioShellCore

// The connect flow: Studio's address (default http://127.0.0.1:3000), the
// workspace slug, and optionally the credential Studio's pairing panel shows.
// Plain AppKit form in a modal alert; the credential field is secure and its
// value is passed straight to the Keychain.
enum ConnectPrompt {
    static func run(pairing: StudioPairing, current: StudioLocation?) -> StudioLocation? {
        NSApp.activate(ignoringOtherApps: true)
        var problem: String?
        while true {
            let address = field(current?.origin.absoluteString ?? StudioLocation.defaultAddress)
            let slug = field(current?.tenantSlug ?? "local")
            let credential = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
            credential.placeholderString = "Optional · asc_…"
            let stack = NSStackView(views: [
                label("Studio address"), address, label("Workspace"), slug,
                label("Pairing credential (optional, kept in your Keychain)"), credential,
            ])
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 4
            stack.frame = NSRect(x: 0, y: 0, width: 320, height: 150)

            let alert = NSAlert()
            alert.messageText = "Connect to Interview Studio"
            alert.informativeText = problem
                ?? "The Studio window opens inside this app. \(VisibilityTruth.line)."
            alert.accessoryView = stack
            alert.addButton(withTitle: "Connect")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return nil }
            switch pairing.pair(
                address: address.stringValue, tenantSlug: slug.stringValue, credential: credential.stringValue)
            {
            case .paired(let location): return location
            case .invalidAddress:
                problem = "Use an https address, or http://127.0.0.1:<port> for a local Studio, and a valid workspace."
            case .invalidCredential: problem = "That credential isn't in the form Studio shows. Leave it empty to skip."
            case .storeFailed: problem = "The pairing couldn't be saved on this Mac."
            }
        }
    }

    private static func field(_ value: String) -> NSTextField {
        let field = NSTextField(string: value)
        field.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        return field
    }

    private static func label(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        return label
    }
}
