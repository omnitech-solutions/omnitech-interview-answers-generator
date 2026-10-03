// SYNTHETIC live-coding exercise set for TypeScript on Node (E-A3). Invented
// and anonymised. The interviewer states a generic rate-limiter task, the
// candidate narrates while typing, and the constraints then change twice more
// mid-exercise; the last change (a token bucket replacing the sliding window)
// invalidates the earlier solution. Narration is deliberately free of
// constraint cues so only the interviewer's lines revise the task.
import type { ReplayFixtureSet } from "./replay-fixtures-hazards.js";
import {
  candidate,
  createScript,
  interviewer,
} from "./session-replay-fixtures.js";

const code = createScript("code");

export const LIVE_CODING: ReplayFixtureSet = {
  phases: [
    code.phase("the interviewer states the task", [
      interviewer(
        "Today I would like you to implement a rate limiter in TypeScript for a Node service. It should allow at most a fixed number of requests per client in a sliding window. Can you walk me through your approach first?",
      ),
      candidate(
        "Okay, I will keep a map from client id to a list of request timestamps, and on each call I drop the timestamps older than the window and compare the remaining count with the limit.",
      ),
      candidate("Let me type the types first."),
      candidate(
        "A function allow takes the client id and the current time and returns a boolean, and I pass the clock in as a parameter so the tests stay deterministic.",
      ),
    ]),
    code.phase("the first changed constraint, bursts", [
      interviewer(
        "Now handle bursts, so allow a small burst above the limit for a client.",
      ),
      candidate(
        "Right, so I add a burst allowance to the options and let the count exceed the limit by that allowance, and I write a test for a client that sends a burst and then waits.",
      ),
    ]),
    code.phase("the second changed constraint, several instances", [
      interviewer(
        "What if the service runs on several instances sharing one store?",
      ),
      candidate(
        "The in memory map no longer works across instances, so I hide the timestamps behind a small store interface, add an in memory version for the tests, and an adapter that keeps the same list in the shared store with an expiry.",
      ),
    ]),
    code.phase(
      "the third changed constraint, invalidating the earlier solution",
      [
        interviewer(
          "Instead, make it a token bucket with a refill rate, and drop the sliding window entirely.",
        ),
        candidate(
          "Okay, that replaces the timestamp lists with a bucket per client holding a token count and the time of the last refill, so I delete the window code and its tests, keep the store interface, and write new tests for refill and for a burst up to the bucket size.",
        ),
        candidate(
          "The allow function now refills first by the elapsed time times the rate, caps at the bucket size, then takes one token if there is one.",
        ),
      ],
    ),
  ],
  expect: {
    description:
      "one coding task opens; three interviewer constraint changes raise it to revision 4",
    opensTasks: 1,
    revisions: [4],
    deferredTopics: 0,
    inertEventIds: [],
  },
};

// What the live-coding path must show when this set is replayed (D6): one
// logical task, a final revision of 4, and the constraints in force at each
// revision. Revision 4 invalidates the earlier solution (the sliding window
// code and tests are replaced), so any solution built for revisions 1 to 3 is
// stale and must not be published for revision 4.
export const LIVE_CODING_EXPECT = {
  language: "typescript",
  taskCount: 1,
  finalRevision: 4,
  revisions: [
    {
      revision: 1,
      reason: "opened",
      constraints: [
        "at most a fixed number of requests per client in a sliding window",
      ],
      invalidatesEarlierSolution: false,
    },
    {
      revision: 2,
      reason: "constraint_changed",
      constraints: [
        "at most a fixed number of requests per client in a sliding window",
        "a small burst above the limit is allowed",
      ],
      invalidatesEarlierSolution: false,
    },
    {
      revision: 3,
      reason: "constraint_changed",
      constraints: [
        "at most a fixed number of requests per client in a sliding window",
        "a small burst above the limit is allowed",
        "several instances share one store",
      ],
      invalidatesEarlierSolution: false,
    },
    {
      revision: 4,
      reason: "constraint_changed",
      constraints: [
        "a token bucket with a refill rate replaces the sliding window",
        "a small burst above the limit is allowed",
        "several instances share one store",
      ],
      invalidatesEarlierSolution: true,
    },
  ],
} as const;
