// The few optional things the native shell may offer beyond the negotiated
// presentation contract. Each is read defensively from `window.studioHost` and
// every one has a page-side fallback, so a shell without it still works:
//   presentation.nativeToasts === true  the shell draws the toasts itself
//   studioHost.quit()                   quit the app (else window.close())
//   studioHost.consent.granted / .open  the shell's one-time consent dialog
//   localStorage `studio.shell.consented=1`  set by the shell's first-run dialog
type Bridge = {
  quit?: unknown;
  consent?: { granted?: unknown; open?: unknown };
  presentation?: { nativeToasts?: unknown };
};

export const CONSENT_FLAG = "studio.shell.consented";

const bridge = (): Bridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as { studioHost?: Bridge }).studioHost;

// The shell draws the toasts: the page must not draw them again.
export const nativeToastsDrawn = (): boolean =>
  bridge()?.presentation?.nativeToasts === true;

// The person accepted the shell's first-run consent.
export function shellConsented(): boolean {
  try {
    const granted = bridge()?.consent?.granted;
    if (typeof granted === "function") return granted() === true;
    if (typeof granted === "boolean") return granted;
  } catch {
    // Fall through to the flag.
  }
  try {
    return window.localStorage.getItem(CONSENT_FLAG) === "1";
  } catch {
    return false;
  }
}

// Asks the shell to show its consent dialog. False when it has none.
export async function openShellConsent(): Promise<boolean> {
  try {
    const open = bridge()?.consent?.open;
    if (typeof open !== "function") return false;
    await open();
    return true;
  } catch {
    return false;
  }
}

// Quits through the shell when it exposes it, otherwise closes this window.
export function quitShell(): void {
  try {
    const quit = bridge()?.quit;
    if (typeof quit === "function") {
      void quit();
      return;
    }
  } catch {
    // Fall through.
  }
  window.close();
}
