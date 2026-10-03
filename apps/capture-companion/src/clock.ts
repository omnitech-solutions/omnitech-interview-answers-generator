// Time is injected so backoff, heartbeats and the replayer run on a virtual
// clock in tests and on the system clock in a real companion.
export type Clock = {
  // Epoch milliseconds.
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const isoAt = (epochMs: number): string =>
  new Date(epochMs).toISOString();
