// What an analyze request asks for, shared by the hands-free controller and
// the native panels' answer pane.

// A new task, or a revision of the task being looked at.
export type AnalyzeChoice = { kind: "new" } | { kind: "attach" };
// Where the pixels come from. "companion": the capture the companion last sent.
// "focused" and "region": ask the native companion to capture now (its focused
// window, or a region of the main display). "share": a fresh frame of a shared
// source.
export type AnalyzeVia = "share" | "companion" | "focused" | "region";
