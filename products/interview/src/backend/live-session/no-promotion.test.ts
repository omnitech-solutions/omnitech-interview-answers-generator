// No promotion (ADR-0011 rule:no-promotion, plan #2 D3): generated answers and
// transcript statements are never promoted into the experience matrix or the
// exercise catalogue. Two checks hold the line:
//   1. a static scan: no live-session production source writes to the matrix,
//      the catalogue or the owner's own records, and none imports their writers
//      (the scan is proven non-vacuous: its pattern matches known writes, and
//      the files it reads really contain the session's own writes);
//   2. a database check: after a full coding and answer run, the matrix and
//      catalogue tables hold exactly the rows they held before.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_ANSWER_PROFILE } from "../../assistant-profile.js";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  seedMatrixProfile,
  settle,
  startSessionForPerson,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { seg } from "./session-replay-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));

// Production sources of the live session: no tests, no test-support fixtures,
// and not the hardening suite's own support files (world.ts, egress-guard.ts),
// which drive the real stream through the Studio view model on purpose.
function productionSources(directory = here): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "hardening" ? [] : productionSources(path);
    const test =
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      /fixture/.test(entry.name);
    return test ? [] : [path];
  });
}

// Tables the session must never write: the experience matrix and the profile,
// the exercise catalogue and attempts, generated briefs and briefings, the
// rehearsal record, and the owner's saved answers, evidence and undo records.
const PROTECTED = [
  "candidate_profiles",
  "candidate_profile_revisions",
  "concept_briefs",
  "briefing_proposals",
  "briefing_links",
  "rehearsal_sessions",
  "exercises",
  "exercise_attempts",
  "assistant_answer_revisions",
  "assistant_evidence",
  "assistant_reverts",
];
const WRITE =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:[a-z_]+"?\."?)?([a-z_]+)"?/gi;
const writesOf = (text: string) =>
  [...text.matchAll(WRITE)].map((match) => String(match[2]).toLowerCase());

const FORBIDDEN_IMPORTS = [
  "interview-library",
  "library-service",
  "/rehearsal/",
  "/briefs/",
  "/plan/",
  "/studio/",
  "/services.js",
  "local-seeds",
];

describe("no promotion: static scan", () => {
  const sources = productionSources().map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));

  it("proves the pattern is not vacuous", () => {
    expect(writesOf("INSERT INTO interview.candidate_profiles (a)")).toEqual([
      "candidate_profiles",
    ]);
    expect(
      writesOf(
        'UPDATE "practice"."exercises" SET x = 1; DELETE FROM practice.exercise_attempts',
      ),
    ).toEqual(["exercises", "exercise_attempts"]);
    expect(writesOf("SELECT 1 FROM interview.candidate_profiles")).toEqual([]);
    // And the scan really reads the session's own writes.
    const written = new Set(sources.flatMap((source) => writesOf(source.text)));
    for (const table of [
      "session_actions",
      "session_observations",
      "active_sessions",
      "assistant_drafts",
    ])
      expect(written).toContain(table);
    expect(sources.length).toBeGreaterThan(30);
  });

  it("writes nothing to the matrix, the catalogue or the owner's records", () => {
    const offenders = sources.flatMap((source) =>
      writesOf(source.text)
        .filter((table) => PROTECTED.includes(table))
        .map((table) => `${source.path.slice(here.length + 1)}: ${table}`),
    );
    expect(offenders).toEqual([]);
  });

  it("imports no writer of the matrix, the catalogue, the library or the rehearsal record", () => {
    const offenders = sources.flatMap((source) =>
      [...source.text.matchAll(/from\s+"([^"]+)"/g)]
        .map((match) => String(match[1]))
        .filter((specifier) =>
          FORBIDDEN_IMPORTS.some((fragment) => specifier.includes(fragment)),
        )
        .map(
          (specifier) => `${source.path.slice(here.length + 1)}: ${specifier}`,
        ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("no promotion: a full coding and answer run", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await startFixture();
  }, 120_000);
  afterAll(() => fx?.stop());

  const TABLES = [
    "interview.candidate_profiles",
    "interview.candidate_profile_revisions",
    "interview.concept_briefs",
    "interview.briefing_proposals",
    "interview.rehearsal_sessions",
    "interview.assistant_evidence",
    "interview.assistant_answer_revisions",
    "practice.exercises",
    "practice.exercise_attempts",
  ];
  // A count and a digest of every row, read as the fixture owner.
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        TABLES.map(async (table) => {
          const result = await fx.owner.query(
            `SELECT count(*) AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS digest FROM ${table} t`,
          );
          return [table, `${result.rows[0].n}:${result.rows[0].digest}`];
        }),
      ),
    );

  it("leaves the matrix and the catalogue tables exactly as they were", async () => {
    const repo = new ActiveSessionRepository(fx.member);
    const person = await fx.provision(fx.tenantA, "no-promotion");
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id);
    const started = await startSessionForPerson(
      fx,
      repo,
      fx.tenantA,
      person,
      "permitted-remote",
      { profile: { id: profile.id } },
    );
    const before = await snapshot();
    expect(before["interview.candidate_profile_revisions"]).not.toMatch(/^0:/);

    // A coding task (solution and session draft) and an experience question
    // whose draft carries a claim the approved matrix does not support.
    const gateway = createFakeGateway({
      result: (request) => {
        const prompt = request.task.prompt;
        if (prompt.startsWith("TASK: solve_code"))
          return {
            language: "typescript",
            code: "export const allow = () => true;",
            testCode: 'it("t0", () => {});',
            coverage: [{ constraintIndex: 0, testName: "t0" }],
            escalation: "none",
            notes: "ok",
          };
        const coding = /rate limiter/i.test(
          prompt.split("END CAPTURED")[0] ?? "",
        );
        return coding
          ? {
              category: "coding",
              draft: "Restate, then outline.",
              claims: [],
              star: null,
              logistics: null,
              codingBrief: {
                language: "typescript",
                restatement: "Implement a rate limiter.",
                constraints: ["a fixed window"],
              },
            }
          : {
              category: "experience-story",
              draft: "Describe the work.",
              claims: [
                {
                  kind: "not-in-matrix",
                  text: "Led a data platform migration at a large scale.",
                  refs: [],
                },
              ],
              star: null,
              logistics: null,
              codingBrief: null,
            };
      },
    });
    const processor = buildProcessor(fx, {
      workerId: "worker-no-promotion",
      gateway,
      codeRunner: {
        runAll: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          timedOut: false,
          tests: [{ name: "t0", status: "passed" }],
        }),
      },
    });
    await started.ingestor.ingest(
      seg(
        "np-1",
        "interviewer",
        0,
        "Can you implement a rate limiter in TypeScript with a fixed window?",
      ),
    );
    await started.ingestor.ingest(
      seg("np-2", "candidate", 8_000, "Sure, I will start with the interface."),
    );
    await started.ingestor.ingest(
      seg(
        "np-3",
        "interviewer",
        20_000,
        "Tell me about a time you led a data platform migration?",
      ),
    );
    await settle(processor, 16);
    await processor.close();

    const actions = await repo.listActions(started.scope, started.sessionId);
    expect(actions.map((a) => [a.actionKind, a.dispatchStatus])).toEqual(
      expect.arrayContaining([
        ["draft-answer", "succeeded"],
        ["solve-code", "succeeded"],
      ]),
    );
    expect(
      gateway.requests.some((r) => r.profileId === INTERVIEW_ANSWER_PROFILE),
    ).toBe(true);
    // The session wrote its own draft - and nothing else outside its tables.
    const drafts = await fx.owner.query(
      "SELECT count(*) AS n FROM interview.assistant_drafts WHERE workspace_id = $1",
      [`active-session:${started.sessionId}`],
    );
    expect(Number(drafts.rows[0].n)).toBe(1);
    expect(await snapshot()).toEqual(before);
    await repo.controlSession(started.scope, started.sessionId, "end");
  }, 90_000);
});
