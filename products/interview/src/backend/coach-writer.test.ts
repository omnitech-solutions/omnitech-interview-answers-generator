// Who may write the coach's notes: one coach holds the pen at a time, under a
// claim that names it and an epoch, for a lease it must renew. The clock is
// the test's own. Every coach named here is invented.
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_HEADER,
  createCoachWriters,
  parseWriter,
  WRITER_HEADER,
} from "./coach-writer";

const LEASE_MS = 15_000;
const LEASE_MAX_MS = 5 * 60_000;

function pen() {
  let clock = Date.parse("2026-10-09T09:00:00.000Z");
  const writers = createCoachWriters(() => clock);
  return {
    writers,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("claiming the pen", () => {
  it("is free at first: nobody holds it, and the first to ask is given it under an epoch", () => {
    const { writers } = pen();
    expect(writers.current()).toBeUndefined();
    const claim = writers.claim("worker-coach");
    expect(claim).toEqual({ id: "worker-coach", epoch: expect.any(Number) });
    expect(claim?.epoch).toBeGreaterThan(0);
    expect(writers.current()).toEqual(claim);
  });

  it("renewing one's own claim keeps its epoch, however often", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach");
    for (let renewed = 0; renewed < 10; renewed += 1) {
      advance(5_000);
      expect(writers.claim("worker-coach")).toEqual(first);
    }
    expect(writers.current()).toEqual(first);
  });

  it("another coach's live claim refuses a plain claim, and the holder is not disturbed", () => {
    const { writers } = pen();
    const held = writers.claim("worker-coach");
    expect(writers.claim("desktop-agent")).toBeNull();
    expect(writers.claim("desktop-agent", { takeover: false })).toBeNull();
    expect(writers.current()).toEqual(held);
    expect(writers.accepts(held as NonNullable<typeof held>)).toBe(true);
    // Being refused does not shorten the holder's lease either.
    expect(writers.claim("worker-coach")).toEqual(held);
  });

  it("another coach's live claim yields to a takeover, under a higher epoch", () => {
    const { writers } = pen();
    const first = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    const taken = writers.claim("desktop-agent", { takeover: true });
    expect(taken).toEqual({ id: "desktop-agent", epoch: expect.any(Number) });
    expect(taken?.epoch).toBeGreaterThan(first.epoch);
    expect(writers.current()).toEqual(taken);
    // The coach that was replaced is refused like anyone else.
    expect(writers.claim("worker-coach")).toBeNull();
  });

  it("a takeover of one's own live claim is a renewal: the same epoch", () => {
    const { writers, advance } = pen();
    const first = writers.claim("desktop-agent", { takeover: true });
    advance(1_000);
    expect(writers.claim("desktop-agent", { takeover: true })).toEqual(first);
  });

  it("a takeover of a free pen is a claim like any other", () => {
    const { writers } = pen();
    expect(writers.claim("desktop-agent", { takeover: true })).toEqual({
      id: "desktop-agent",
      epoch: expect.any(Number),
    });
  });

  it("epochs only rise: each new holder's is higher than every one before it", () => {
    const { writers, advance } = pen();
    const seen: number[] = [];
    for (const id of ["coach-a", "coach-b", "coach-a", "coach-c", "coach-a"]) {
      seen.push(
        (writers.claim(id, { takeover: true }) as { epoch: number }).epoch,
      );
      advance(100);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("two pens are apart: a claim on one says nothing of the other", () => {
    const one = pen().writers;
    const other = pen().writers;
    one.claim("worker-coach");
    expect(other.current()).toBeUndefined();
    expect(other.claim("desktop-agent")).not.toBeNull();
  });

  it("reads the wall clock when it is given none", () => {
    const writers = createCoachWriters();
    const claim = writers.claim("worker-coach");
    expect(writers.current()).toEqual(claim);
  });
});

describe("a claim's lease", () => {
  it("stands 15 s by default: live to the last millisecond, lapsed at the lease's end", () => {
    const { writers, advance } = pen();
    const claim = writers.claim("worker-coach");
    advance(LEASE_MS - 1);
    expect(writers.current()).toEqual(claim);
    expect(writers.claim("desktop-agent")).toBeNull();
    advance(1);
    expect(writers.current()).toBeUndefined();
  });

  it("once lapsed, another coach's plain claim is given the pen, under a higher epoch", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach") as { epoch: number };
    advance(LEASE_MS);
    const next = writers.claim("desktop-agent");
    expect(next?.id).toBe("desktop-agent");
    expect(next?.epoch).toBeGreaterThan(first.epoch);
  });

  it("is counted from the last renewal, not from the first claim", () => {
    const { writers, advance } = pen();
    const claim = writers.claim("worker-coach");
    advance(10_000);
    writers.claim("worker-coach");
    advance(LEASE_MS - 1);
    expect(writers.current()).toEqual(claim);
    advance(1);
    expect(writers.current()).toBeUndefined();
  });

  it("a coach that claims again after its own lease lapsed is a new holder: a higher epoch", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach") as { epoch: number };
    advance(LEASE_MS + 1);
    const again = writers.claim("worker-coach") as { epoch: number };
    expect(again.epoch).toBeGreaterThan(first.epoch);
  });

  it("is as long as the claim asks, up to 5 minutes", () => {
    const { writers, advance } = pen();
    const claim = writers.claim("desktop-agent", { leaseMs: 180_000 });
    advance(180_000 - 1);
    expect(writers.current()).toEqual(claim);
    advance(1);
    expect(writers.current()).toBeUndefined();
  });

  it.each([
    LEASE_MAX_MS + 1,
    60 * 60_000,
    Number.MAX_SAFE_INTEGER,
    Number.POSITIVE_INFINITY,
  ])("is 5 minutes at most, whatever is asked (%d ms)", (leaseMs) => {
    const { writers, advance } = pen();
    const claim = writers.claim("desktop-agent", { leaseMs });
    advance(LEASE_MAX_MS - 1);
    expect(writers.current()).toEqual(claim);
    advance(1);
    expect(writers.current()).toBeUndefined();
    expect(writers.claim("worker-coach")).not.toBeNull();
  });

  it.each([0, -5_000, 1, 999])(
    "is a second at least, whatever is asked (%d ms)",
    (leaseMs) => {
      const { writers, advance } = pen();
      const claim = writers.claim("desktop-agent", { leaseMs });
      advance(999);
      expect(writers.current()).toEqual(claim);
      advance(1);
      expect(writers.current()).toBeUndefined();
    },
  );

  it("a renewal sets the lease anew: a long one may be followed by a short one", () => {
    const { writers, advance } = pen();
    writers.claim("desktop-agent", { leaseMs: 180_000 });
    writers.claim("desktop-agent");
    advance(LEASE_MS);
    expect(writers.current()).toBeUndefined();
  });

  // DEFECT, minor (coach-writer.ts:33-36; not reachable over HTTP, where
  // `leaseSeconds` is JSON and so never NaN): a lease that is not a number at all is
  // not clamped. `Math.max(1_000, NaN)` is NaN, so the claim is handed out
  // (an id and an epoch) but is never live: its holder is told it holds the
  // pen while `current()` says nobody does and any other coach's plain claim
  // takes it at once. A lease that cannot be read should be the default one.
  it("DEFECT: a lease that is not a number is the default lease, not a claim that never stands", () => {
    const { writers } = pen();
    const claim = writers.claim("worker-coach", { leaseMs: Number.NaN });
    expect(claim).not.toBeNull();
    expect(writers.current()).toEqual(claim);
    expect(writers.claim("desktop-agent")).toBeNull();
  });
});

describe("whose notes are taken", () => {
  it("the current holder's, by its id and its epoch together", () => {
    const { writers } = pen();
    const claim = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    expect(writers.accepts(claim)).toBe(true);
    expect(writers.accepts({ ...claim })).toBe(true);
    expect(writers.accepts({ id: claim.id, epoch: claim.epoch + 1 })).toBe(
      false,
    );
    expect(writers.accepts({ id: claim.id, epoch: claim.epoch - 1 })).toBe(
      false,
    );
    expect(writers.accepts({ id: "desktop-agent", epoch: claim.epoch })).toBe(
      false,
    );
  });

  it("never those of a coach that was taken over from, from that moment", () => {
    const { writers } = pen();
    const first = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    const taken = writers.claim("desktop-agent", { takeover: true }) as {
      id: string;
      epoch: number;
    };
    expect(writers.accepts(first)).toBe(false);
    expect(writers.accepts(taken)).toBe(true);
    // Nor does naming the new epoch under the old name pass.
    expect(writers.accepts({ id: first.id, epoch: taken.epoch })).toBe(false);
  });

  it("keeps refusing the replaced coach after the coach that replaced it has gone", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    const taken = writers.claim("desktop-agent", { takeover: true }) as {
      id: string;
      epoch: number;
    };
    advance(LEASE_MS);
    // The pen is free: the last holder may finish, the one before it may not.
    expect(writers.current()).toBeUndefined();
    expect(writers.accepts(taken)).toBe(true);
    expect(writers.accepts(first)).toBe(false);
  });

  it("anyone's while the pen has never been held", () => {
    const { writers } = pen();
    expect(writers.accepts({ id: "worker-coach", epoch: 1 })).toBe(true);
    expect(writers.accepts({ id: "never-claimed", epoch: 42 })).toBe(true);
  });

  it("the last holder's once its lease has lapsed and the pen is free, by its epoch", () => {
    const { writers, advance } = pen();
    const claim = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    advance(LEASE_MS + 1);
    expect(writers.current()).toBeUndefined();
    expect(writers.accepts(claim)).toBe(true);
    expect(writers.accepts({ id: claim.id, epoch: claim.epoch + 1 })).toBe(
      false,
    );
    expect(writers.accepts({ id: claim.id, epoch: claim.epoch - 1 })).toBe(
      false,
    );
  });

  it("not the lapsed holder's once another coach has claimed the free pen", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    advance(LEASE_MS + 1);
    const next = writers.claim("desktop-agent") as {
      id: string;
      epoch: number;
    };
    expect(writers.accepts(first)).toBe(false);
    expect(writers.accepts(next)).toBe(true);
  });

  it("not a coach's own earlier claim once it has claimed again after lapsing", () => {
    const { writers, advance } = pen();
    const first = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    advance(LEASE_MS + 1);
    const again = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    expect(writers.accepts(first)).toBe(false);
    expect(writers.accepts(again)).toBe(true);
  });
});

describe("giving the pen up", () => {
  it("frees it at once: nobody holds it and another coach's plain claim is given it", () => {
    const { writers } = pen();
    const first = writers.claim("worker-coach") as { epoch: number };
    writers.release("worker-coach");
    expect(writers.current()).toBeUndefined();
    const next = writers.claim("desktop-agent");
    expect(next?.epoch).toBeGreaterThan(first.epoch);
  });

  it("leaves the coach that gave it up its last notes, until somebody else holds it", () => {
    const { writers } = pen();
    const claim = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    writers.release("worker-coach");
    expect(writers.accepts(claim)).toBe(true);
    writers.claim("desktop-agent");
    expect(writers.accepts(claim)).toBe(false);
  });

  it.each(["desktop-agent", "", "worker-coach-2", "WORKER-COACH"])(
    "is only the holder's to give up: %j releasing it changes nothing",
    (other) => {
      const { writers } = pen();
      const claim = writers.claim("worker-coach");
      writers.release(other);
      expect(writers.current()).toEqual(claim);
      expect(writers.claim("desktop-agent")).toBeNull();
    },
  );

  it("is nothing on a pen nobody ever held, and nothing the second time", () => {
    const { writers } = pen();
    expect(() => writers.release("worker-coach")).not.toThrow();
    writers.claim("worker-coach");
    writers.release("worker-coach");
    writers.release("worker-coach");
    expect(writers.current()).toBeUndefined();
  });

  it("a coach that claims again after giving it up is a new holder: a higher epoch", () => {
    const { writers } = pen();
    const first = writers.claim("worker-coach") as { epoch: number };
    writers.release("worker-coach");
    expect(
      (writers.claim("worker-coach") as { epoch: number }).epoch,
    ).toBeGreaterThan(first.epoch);
  });
});

describe("a claim as a note names it", () => {
  it("is carried in one header, beside the conversation's", () => {
    expect(WRITER_HEADER).toBe("x-coach-writer");
    expect(CONVERSATION_HEADER).toBe("x-coach-conversation");
  });

  it.each<[string, { id: string; epoch: number }]>([
    ["worker-coach:1", { id: "worker-coach", epoch: 1 }],
    ["coach-48213:17", { id: "coach-48213", epoch: 17 }],
    ["desktop.agent_2:0", { id: "desktop.agent_2", epoch: 0 }],
    ["a:999999999999", { id: "a", epoch: 999_999_999_999 }],
    [`${"a".repeat(64)}:3`, { id: "a".repeat(64), epoch: 3 }],
  ])("reads %j as an id and an epoch", (header, claim) => {
    expect(parseWriter(header)).toEqual(claim);
  });

  it.each<[string, string | undefined]>([
    ["no header", undefined],
    ["an empty one", ""],
    ["an id alone", "worker-coach"],
    ["an id and a colon", "worker-coach:"],
    ["an epoch alone", ":4"],
    ["an epoch that is not a number", "worker-coach:four"],
    ["a negative epoch", "worker-coach:-1"],
    ["an epoch with a fraction", "worker-coach:1.5"],
    ["an epoch of thirteen digits", "worker-coach:1234567890123"],
    ["an id of sixty-five characters", `${"a".repeat(65)}:1`],
    ["an id with a space", "worker coach:1"],
    ["an id with a slash", "worker/coach:1"],
    ["two colons", "worker:coach:1"],
    ["space around it", " worker-coach:1 "],
    ["a line after it", "worker-coach:1\nx"],
  ])("reads %s as no claim", (_name, header) => {
    expect(parseWriter(header)).toBeNull();
  });

  it("a claim read from its own header is the claim the pen accepts", () => {
    const { writers } = pen();
    const claim = writers.claim("worker-coach") as {
      id: string;
      epoch: number;
    };
    const read = parseWriter(`${claim.id}:${claim.epoch}`);
    expect(read).toEqual(claim);
    expect(writers.accepts(read as NonNullable<typeof read>)).toBe(true);
  });
});
