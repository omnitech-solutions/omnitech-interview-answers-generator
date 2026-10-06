import Foundation

// Moving a floating window by any empty part of its page. A web view takes every
// mouse event itself and WKWebView has no `-webkit-app-region`, so the shell watches
// the press, and once the pointer travels `threshold` points it asks the page
// whether that spot is empty (not a control, text field, code or selectable
// result): if so the window is dragged, otherwise the page keeps the gesture.
//
// [DOMAIN] The toolbar and footer always drag (around their buttons). The rest of
// the page drags unless the glass is see-through, where the card is for reading and
// the window is moved by its toolbar and footer.
public enum WindowDrag {
    public static let threshold = 4.0

    // Anything the person operates or selects keeps its own gesture.
    static let controls = [
        "button", "a", "input", "textarea", "select", "label", "summary",
        "[role=button]", "[role=menuitem]", "[role=menuitemradio]", "[role=slider]",
        "[role=tab]", "[role=switch]", "[role=checkbox]", "[role=radio]",
        "[contenteditable]", "pre", "code", ".cm-editor", "[data-no-drag]",
    ].joined(separator: ",")
    static let chrome = ".pn-pill,.pn-single-foot"

    // The page's answer: true when a drag may start at (x, y) in page points.
    public static func probeScript(x: Double, y: Double) -> String {
        """
        (function () {
          var el = document.elementFromPoint(\(x), \(y));
          if (!el) return false;
          if (el.closest('\(controls)')) return false;
          if (el.closest('\(chrome)')) return true;
          return !document.querySelector('[data-glass="clear"]');
        })()
        """
    }

    public static func exceedsThreshold(dx: Double, dy: Double) -> Bool {
        (dx * dx + dy * dy).squareRoot() > threshold
    }
}
