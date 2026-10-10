// Storage is optional (SSR, private windows, quota); the allowed set is not.
export function stored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): {
  read(): T;
  write(value: T): void;
  clear(): void;
} {
  return {
    read() {
      try {
        const value = window.localStorage.getItem(key);
        return allowed.find((each) => each === value) ?? fallback;
      } catch {
        return fallback;
      }
    },
    write(value) {
      if (!allowed.includes(value)) return;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // The current page can still use its in-memory preference.
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Storage may be unavailable; clearing must not break the screen.
      }
    },
  };
}
