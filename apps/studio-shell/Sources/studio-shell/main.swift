// studio-shell: Interview Studio in its own floating window (ADR-0019).
//
// The window loads the one overlay route every host loads (ADR-0017). Studio
// keeps all session state, assist requests, masks and locality; this process
// fulfils capture for the page through `window.studioHost` and offers window
// chrome: pin on top, a menu-bar item and two global keys. It is an ordinary,
// visible window: nothing here hides it from, or disguises it for, screen
// sharing (ADR-0018). It is an accessory app (no Dock icon, no app switcher
// entry) so it never takes the focus from the window being interviewed in.
//
// Output: none. Nothing here prints or logs content, addresses or credentials.
import AppKit

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
