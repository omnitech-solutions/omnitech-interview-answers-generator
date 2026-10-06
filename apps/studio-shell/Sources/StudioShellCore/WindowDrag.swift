import Foundation

// Moving a floating window by any empty part of its page. A web view takes every
// mouse event itself and WKWebView has no `-webkit-app-region`, so the shell watches
// the press, and once the pointer travels `threshold` points it asks the page
// whether that spot is drawn by the page (a surface from its hit list, so never
// transparent glass) and empty (not a control, text field, code or selectable
// result): if so the window is dragged, otherwise the page keeps the gesture. The
// same answer picks the cursor.
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

    // What the pointer is over, as the cursor it should show. A web view in a panel of
    // an inactive app does not apply CSS cursors, so the shell sets them itself.
    //   pointer  something to press (button, link, menu item, tab ...)
    //   text     a text field or selectable code
    //   grab     an empty drawn part of the window: it can be dragged
    //   arrow    anything else (not drawn, disabled, a surface kept for reading)
    public enum Kind: String, Sendable { case pointer, text, grab, arrow }

    static let pressable = [
        "button", "a[href]", "summary", "label", "select", "[role=button]", "[role=menuitem]",
        "[role=menuitemradio]", "[role=slider]", "[role=tab]", "[role=switch]", "[role=checkbox]",
        "[role=radio]",
    ].joined(separator: ",")
    // Text to read and copy: the fields, the code, the transcript, the answers. The
    // same list is in panels.css (user-select and the text cursor); keep them together.
    static let typing =
        "input:not([type=button]):not([type=submit]),textarea,[contenteditable],pre,code,.cm-editor,.pn-log,.pn-interim,.pn-analysis-text,.pn-codecard"

    // The page's answer at (x, y) in page points: a `Kind`, as its raw value.
    public static func probeScript(x: Double, y: Double) -> String {
        """
        (function () {
          var el = document.elementFromPoint(\(x), \(y));
          if (!el) return 'arrow';
          // A page that has not said what it draws (an older page) is not restricted.
          var drawn = document.documentElement.getAttribute('data-hit-surfaces');
          if (drawn && !el.closest(drawn)) return 'arrow';
          if (el.closest('[disabled],[aria-disabled=true],[data-no-drag]')) return 'arrow';
          if (el.closest('\(pressable)')) return 'pointer';
          if (el.closest('\(typing)')) return 'text';
          if (el.closest('\(controls)')) return 'arrow';
          if (el.closest('\(chrome)')) return 'grab';
          return document.querySelector('[data-glass="clear"]') ? 'arrow' : 'grab';
        })()
        """
    }

    public static func exceedsThreshold(dx: Double, dy: Double) -> Bool {
        (dx * dx + dy * dy).squareRoot() > threshold
    }
}
