// Browser storage that never throws: private windows and blocked site data make
// `localStorage` throw on access, so a read or write falls back to memory for
// this page visit instead of breaking the screen.
export type SafeStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

const memory = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
};

export function safeStorage(kind: "local" | "session"): SafeStorage {
  const fallback = memory[kind];
  const store = (): Storage | null => {
    try {
      return kind === "local" ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        const value = store()?.getItem(key);
        if (value !== undefined) return value;
      } catch {
        // Fall back to this visit's memory.
      }
      return fallback.get(key) ?? null;
    },
    set(key, value) {
      fallback.set(key, value);
      try {
        store()?.setItem(key, value);
      } catch {
        // The memory copy still serves this visit.
      }
    },
    remove(key) {
      fallback.delete(key);
      try {
        store()?.removeItem(key);
      } catch {
        // Nothing stored to remove.
      }
    },
  };
}
