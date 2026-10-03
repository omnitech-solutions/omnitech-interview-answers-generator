import Foundation

// [SAFETY] Which screen content may be captured. The person either named a
// window (by a title fragment) or chose the display. A named window that is not
// on screen (a typo, a minimised window) must NEVER fall back to the whole
// display: that would send content the person did not select.
public enum ScreenTarget: Equatable, Sendable {
    case window(index: Int)
    case display
    case windowNotFound

    public static func choose(titleFragment: String?, windowTitles: [String?]) -> ScreenTarget {
        guard let fragment = titleFragment, !fragment.isEmpty else { return .display }
        if let index = windowTitles.firstIndex(where: { $0?.localizedCaseInsensitiveContains(fragment) == true }) {
            return .window(index: index)
        }
        return .windowNotFound
    }
}
