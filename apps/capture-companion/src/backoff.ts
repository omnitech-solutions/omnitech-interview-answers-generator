// Exponential backoff with injected jitter, so a reconnect storm after a
// Studio outage spreads out and tests are deterministic.
export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  // Returns a value in [0, 1); injected so tests need no randomness.
  jitter?: () => number;
};

export type Backoff = {
  // The delay before the next attempt; each call grows the next delay.
  next(): number;
  // A response arrived: the next failure starts from the base again.
  reset(): void;
};

export function createBackoff(options: BackoffOptions = {}): Backoff {
  const baseMs = options.baseMs ?? 1_000;
  const maxMs = options.maxMs ?? 60_000;
  const jitter = options.jitter ?? Math.random;
  let attempt = 0;
  return {
    next() {
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
      attempt += 1;
      // [STRATEGY] Equal jitter: keeps at least half the delay so retries never
      // collapse to zero, and spreads the other half.
      return Math.round(ceiling / 2 + (ceiling / 2) * jitter());
    },
    reset() {
      attempt = 0;
    },
  };
}
