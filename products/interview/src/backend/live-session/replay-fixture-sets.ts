// The registry of every synthetic replay set (E-A1, E-A3), so one privacy scan
// and later replay tests cover all of them. allFixtureTexts() in
// session-replay-fixtures.ts still returns the recruiter-screen strings only.
import {
  CANDIDATE_PREFERENCES,
  CANDIDATE_PREFERENCES_NONE,
  matrixTexts,
} from "./replay-fixture-matrix.js";
import { LIVE_CODING } from "./replay-fixtures-coding.js";
import { HAZARD_FIXTURES } from "./replay-fixtures-hazards.js";
import { MANAGER_FIXTURE } from "./replay-fixtures-manager.js";
import {
  RECRUITER_SCREEN,
  type ReplayPhase,
} from "./session-replay-fixtures.js";

export const ALL_REPLAY_SETS: Readonly<
  Record<string, { phases: readonly ReplayPhase[] }>
> = {
  "recruiter-screen": { phases: RECRUITER_SCREEN },
  ...HAZARD_FIXTURES,
  "engineering-manager": MANAGER_FIXTURE,
  "live-coding": LIVE_CODING,
};

// Every string any fixture carries: set names, phase names, spoken text, the
// synthetic matrix and both preference variants.
export const allReplayFixtureTexts = (): string[] => [
  ...Object.entries(ALL_REPLAY_SETS).flatMap(([name, set]) => [
    name,
    ...set.phases.flatMap((phase) => [
      phase.name,
      ...phase.segments.map((segment) => segment.text),
    ]),
  ]),
  ...matrixTexts(),
  CANDIDATE_PREFERENCES,
  CANDIDATE_PREFERENCES_NONE,
];
