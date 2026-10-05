// studio-shell: Interview Studio in its own floating window (ADR-0019).
//
// The window loads the one overlay route every host loads (ADR-0017). Studio
// keeps all session state, assist requests, masks and locality; this process
// fulfils capture for the page through `window.studioHost` and offers window
// chrome. It is a regular app (Dock icon, app menu, Cmd-Q) whose main window
// is the full Studio ("expanded"); "minified" hides it and shows the one
// floating compact window, which is non-activating so it never takes the focus
// from the window being interviewed in. Every window is ordinary and visible:
// nothing here hides it from, or disguises it for, screen sharing (ADR-0018).
//
// Output: none. Nothing here prints or logs content, addresses or credentials.
import AppKit

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegate = AppDelegate()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
}
