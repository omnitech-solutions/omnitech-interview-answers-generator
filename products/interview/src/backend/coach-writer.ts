// Who may write the coach's notes right now.
//
// PROBLEM: more than one coach can be running (the built-in one in the
// worker, a desktop agent coaching by hand, a second worker after a restart),
// and each can only cancel its own work. A note that left a coach before it
// was told to stand down still arrives. STRATEGY: the Studio, which takes the
// notes, is the one place that knows who holds the pen. A coach claims it and
// is given an epoch; every note it posts names that claim, and a note from a
// claim that is no longer the current one is refused here, whatever its
// writer believes. A claim lapses unless renewed, so a coach that died does
// not hold the pen for ever.
// A note posted with no claim at all (a person, a script) is always taken.

// How long a claim stands without being renewed, and the longest one may ask.
const LEASE_MS = 15_000;
const LEASE_MAX_MS = 5 * 60_000;

export type WriterClaim = { id: string; epoch: number };

export function createCoachWriters(nowMs: () => number = Date.now) {
  let holder: (WriterClaim & { untilMs: number }) | undefined;
  let epoch = 0;
  const live = () => (holder && holder.untilMs > nowMs() ? holder : undefined);
  return {
    // The pen, for `id`. Renewing one's own claim keeps its epoch. Another
    // coach's live claim refuses this one, unless `takeover` is asked for (a
    // person putting a desktop agent in charge): then the earlier claim is
    // over and its notes are refused from that moment.
    claim(
      id: string,
      options: { takeover?: boolean; leaseMs?: number } = {},
    ): WriterClaim | null {
      const asked = options.leaseMs ?? LEASE_MS;
      const lease = Math.min(
        LEASE_MAX_MS,
        // Not a number at all is the ordinary lease; too long is the longest.
        Math.max(1_000, Number.isNaN(asked) ? LEASE_MS : asked),
      );
      const current = live();
      if (current && current.id !== id && !options.takeover) return null;
      if (!current || current.id !== id) epoch += 1;
      holder = {
        id,
        epoch: current?.id === id ? current.epoch : epoch,
        untilMs: nowMs() + lease,
      };
      return { id: holder.id, epoch: holder.epoch };
    },
    // Whether a note naming this claim may be written.
    accepts(claim: WriterClaim): boolean {
      const current = live();
      // The pen is free: the last holder's notes are still theirs to finish.
      if (!current) return holder === undefined || claim.epoch === holder.epoch;
      return current.id === claim.id && current.epoch === claim.epoch;
    },
    release(id: string): void {
      if (holder?.id === id) holder = { ...holder, untilMs: 0 };
    },
    current: (): WriterClaim | undefined => {
      const current = live();
      return current ? { id: current.id, epoch: current.epoch } : undefined;
    },
  };
}

export const coachWriters = createCoachWriters();

// A claim as a note names it, in one header: "<id>:<epoch>".
export const WRITER_HEADER = "x-coach-writer";
// The conversation a note was written from: the transcript's epoch.
export const CONVERSATION_HEADER = "x-coach-conversation";
export function parseWriter(header: string | undefined): WriterClaim | null {
  const found = /^([\w.-]{1,64}):(\d{1,12})$/.exec(header ?? "");
  return found ? { id: found[1] as string, epoch: Number(found[2]) } : null;
}
