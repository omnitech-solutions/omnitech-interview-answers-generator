// How "New document" makes a document, as the person last chose it, remembered
// in this browser. The first visit writes with AI; a stored value that is not
// one of the two is ignored. localStorage is optional and guarded.
export type CreationMode = "ai" | "manual";

const KEY = "interview-studio.documents.creation-mode";

export function loadCreationMode(): CreationMode {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "manual" || stored === "ai" ? stored : "ai";
  } catch {
    return "ai";
  }
}

export function saveCreationMode(mode: CreationMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Kept for this dialog only.
  }
}
