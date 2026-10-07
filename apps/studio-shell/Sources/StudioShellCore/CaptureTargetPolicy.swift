import Foundation

// [DOMAIN] Why a capture was asked for. An EXPLICIT capture (the Capture or
// Analyze button, the capture hotkey, Add screenshot) is the person's own
// request for the browser they were just working in, so it may look at the last
// focused browser even when another app (a chat, a terminal) is in front. An
// AUTO capture runs by itself, so it looks only while a browser is in front.
// [SAFETY] Absent on the wire means auto: the narrower rule is the default.
public enum CaptureIntent: String, Equatable, Sendable {
    case explicit
    case auto

    // nil: a value that is neither (a refusal at the decoder).
    public init?(wire: String?) {
        guard let wire else { self = .auto; return }
        self.init(rawValue: wire)
    }
}

// [SAFETY] Which application a capture may look at. Never the shell itself,
// never a non-browser, never widened to "the whole screen": with no eligible
// browser the answer is nil and the reply is `no-focused-window`.
public enum CaptureTargetPolicy {
    public static func decide(
        intent: CaptureIntent, frontmost: Int32?, ownPid: Int32, lastOther: Int32?, lastBrowser: Int32?,
        isBrowser: (Int32) -> Bool
    ) -> Int32? {
        // The application in front at receipt (the shell stands aside for the last other).
        if let sampled = FocusSampling.sample(frontmost: frontmost, ownPid: ownPid, lastOther: lastOther),
            isBrowser(sampled)
        {
            return sampled
        }
        // Only the person's own request may reach back to the last focused browser.
        guard intent == .explicit, let lastBrowser, lastBrowser != ownPid, isBrowser(lastBrowser) else { return nil }
        return lastBrowser
    }
}

// [SAFETY] The application NAME that was in front, so the page can say what to
// leave: never a window title or an address. Bounded, with control and
// bidirectional-override characters dropped.
public enum FrontAppName {
    public static let maxCharacters = 64

    public static func sanitize(_ name: String?) -> String? {
        guard let name else { return nil }
        let kept = name.unicodeScalars.filter { scalar in
            switch scalar.properties.generalCategory {
            // Control, bidi and other format characters, and the U+2028/2029 line breaks.
            case .control, .format, .lineSeparator, .paragraphSeparator: return false
            default: return true
            }
        }
        let text = String(String.UnicodeScalarView(kept)).trimmingCharacters(in: .whitespacesAndNewlines)
        // Bounded by scalars, not grapheme clusters (a cluster can be arbitrarily long).
        let bounded = String(String.UnicodeScalarView(text.unicodeScalars.prefix(maxCharacters)))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return bounded.isEmpty ? nil : bounded
    }
}
