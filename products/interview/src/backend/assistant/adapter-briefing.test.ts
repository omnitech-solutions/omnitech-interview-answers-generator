import type { BriefingDraft } from "@omnitech/interview-contracts";
import type { Proposal } from "@omnitech-assistant/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BriefingRepository } from "../briefing/repository";
import { createInterviewAdapter, describeChanges } from "./adapter";
import { InterviewWorkspaceRepository } from "./workspace";
import { disposablePostgres } from "./workspace-fixture";

// Every log line the adapter writes, as the JSON a deployment would emit
// (through the real logger and its redaction), so a test can read an event.
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@omnitech/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@omnitech/logging")>();
  return {
    ...actual,
    createLogger: (options: Parameters<typeof actual.createLogger>[0]) =>
      actual.createLogger({
        ...options,
        level: "info",
        format: "json",
        write: (line) => logged.push(line),
      }),
  };
});

const scope = {
  tenantId: "ground",
  actorId: "alice",
  productId: "omnitech.interview",
};
const SHA = "a".repeat(64);
const answer = (id: string, question: string) => ({
  id,
  question,
  category: "background" as const,
  answerMarkdown: `I would answer ${question}`,
  talkingPoints: ["One", "Two", "Three"],
  evidenceRefs: [
    {
      id: "profile",
      revision: 1,
      sha256: SHA,
      pointer: "/roles/0/proof_points/0",
      quote: "Mentored engineers",
      sourceKind: "candidate" as const,
    },
  ],
  gaps: [],
  accepted: true,
});
const pack: BriefingDraft = {
  kind: "non-technical-briefing",
  title: "Acme · Tech Lead",
  context: {
    company: "Acme",
    role: "Tech Lead",
    stage: "recruiter",
    interviewer: "Sam",
    profile: { id: "profile", revision: 1 },
  },
  expected: ["Tell me about yourself.", "Why Acme?"],
  questions: [
    answer("q1", "Tell me about yourself."),
    answer("q2", "Why Acme?"),
  ],
};
const origin = {
  workspaceId: "briefings",
  artifactId: "pack",
  artifactRevision: 0,
};

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
let workspace: InterviewWorkspaceRepository;
const adapter = () => createInterviewAdapter(pg.database);
const proposal = (patch: Record<string, unknown>, at = origin) =>
  ({
    id: `p-${Math.random()}`,
    origin: at,
    patch,
    evidence: [],
  }) as unknown as Proposal;

beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
  workspace = new InterviewWorkspaceRepository(pg.database);
  await new BriefingRepository(pg.database).importProfile(scope, {
    name: "Synthetic",
    profileId: "profile",
    matrix: {
      candidate: { name: "Synthetic" },
      roles: [
        {
          company: "Relay",
          title: "Principal Engineer",
          period: "2021–2024",
          proof_points: ["Mentored engineers"],
        },
      ],
    },
  });
  await workspace.create(scope, origin, {
    question: pack.title,
    briefing: pack,
  });
});
afterAll(async () => {
  await pg?.close();
});

describe("the assistant on a behavioural pack", () => {
  it("sees the employer's material apart from the person's own roles and answers", async () => {
    const context = await adapter().getContext(scope, origin);
    expect(context.instructions?.join(" ")).toContain("briefingAnswers");
    expect(context.context).toMatchObject({
      kind: "behavioural-briefing-pack",
      title: "Acme · Tech Lead",
      employer: { company: "Acme", interviewer: "Sam" },
      you: {
        matrixRoles: [
          {
            roleId: "/roles/0",
            company: "Relay",
            title: "Principal Engineer",
            period: "2021–2024",
          },
        ],
        expectedQuestions: ["Tell me about yourself.", "Why Acme?"],
        answers: [
          {
            id: "q1",
            accepted: true,
            evidence: [
              {
                pointer: "/roles/0/proof_points/0",
                quote: "Mentored engineers",
              },
            ],
          },
          { id: "q2" },
        ],
      },
      preparedBriefing: null,
    });
    const { employer } = context.context as { employer: object };
    expect(employer).not.toHaveProperty("profile");
    expect(employer).not.toHaveProperty("request");
    expect(context.evidence).toEqual([]);
  });

  it("reads a condensed field in place of its original, and logs the context's sizes only", async () => {
    const posting = `POSTING-ORIGINAL ${"Own the roadmap. ".repeat(400)}`;
    const research = "RESEARCH-ORIGINAL the interviewer joined from ecobee";
    const at = { ...origin, artifactId: "condensed-pack" };
    const condensed: BriefingDraft = {
      ...pack,
      context: {
        ...pack.context,
        jobDescription: posting,
        research,
        employerNotes: "NOTES-ORIGINAL",
        // Only the posting was long enough to condense.
        condensed: { jobDescription: "CONDENSED-POSTING owns the roadmap" },
      },
    };
    await workspace.create(scope, at, {
      question: condensed.title,
      briefing: condensed,
    });
    logged.length = 0;
    const context = await adapter().getContext(scope, at);
    // What the turn costs is the pack as the assistant sees it, without the
    // prompt's own version stamp.
    const { prompt: _prompt, ...seen } = context.context as {
      prompt: unknown;
      employer: Record<string, unknown>;
      you: { answers: unknown };
      preparedBriefing: unknown;
    };
    expect(seen.employer).toEqual({
      company: "Acme",
      role: "Tech Lead",
      stage: "recruiter",
      interviewer: "Sam",
      jobDescription: "CONDENSED-POSTING owns the roadmap",
      research,
      employerNotes: "NOTES-ORIGINAL",
    });
    expect(JSON.stringify(context)).not.toContain("POSTING-ORIGINAL");
    // The pack itself still holds what was pasted.
    expect(
      (await workspace.read(scope, "briefings", at.artifactId)).value.briefing!
        .context.jobDescription,
    ).toBe(posting);

    const size = (value: unknown) => JSON.stringify(value).length;
    const lines = logged.filter((line) => line.includes("assistant.context"));
    expect(lines).toHaveLength(1);
    const { time: _time, ...event } = JSON.parse(lines[0]!);
    expect(event).toEqual({
      level: "info",
      service: "assistant",
      event: "assistant.context",
      artifactId: "condensed-pack",
      revision: 0,
      totalChars: size(seen),
      jobDescriptionChars: size("CONDENSED-POSTING owns the roadmap"),
      researchChars: size(research),
      answersChars: size(seen.you.answers),
      // No prepared briefing counts as the two quotes of an empty string.
      preparedChars: 2,
      condensed: true,
    });
    expect(logged.join("\n")).not.toMatch(/ORIGINAL|CONDENSED-POSTING/);

    // A pack with no condensed copy is read whole, and the log says so.
    logged.length = 0;
    await adapter().getContext(scope, origin);
    expect(
      JSON.parse(logged.find((line) => line.includes("assistant.context"))!),
    ).toMatchObject({
      artifactId: "pack",
      condensed: false,
      // Absent fields count as the two quotes of an empty string.
      jobDescriptionChars: 2,
      researchChars: 2,
    });
  });

  it("proposes answer edits by id, for review one answer at a time", async () => {
    const built = await adapter().buildProposal!(scope, origin, {
      briefingAnswers: [
        { id: "q1", answerMarkdown: "A tighter answer." },
        { id: "q2", talkingPoints: ["A", "B", "C"] },
      ],
    });
    const patch = built.patch as { briefing: BriefingDraft };
    expect(patch.briefing.context).toEqual(pack.context);
    expect(patch.briefing.questions[0]).toMatchObject({
      answerMarkdown: "A tighter answer.",
      accepted: false,
      evidenceRefs: [],
      gaps: ["Review the edited answer against its sources."],
    });

    const changes = await adapter().describeProposal!(
      scope,
      proposal(built.patch as Record<string, unknown>),
    );
    expect(changes.map((change) => change.label)).toEqual([
      "Tell me about yourself.",
      "Why Acme?",
    ]);
    expect(changes[0]).toMatchObject({
      id: "briefing:q1",
      after: "A tighter answer.\n\n- One\n- Two\n- Three",
    });

    // Applying only the first answer leaves the second as it was.
    const receipt = await workspace.transaction(scope, (tx, current) =>
      adapter().applyProposal(
        tx,
        current,
        proposal(built.patch as Record<string, unknown>),
        { surfaces: ["briefing:q1"] },
      ),
    );
    const stored = await workspace.read(scope, "briefings", "pack");
    expect(stored.origin.artifactRevision).toBe(receipt.artifactRevision);
    expect(stored.value.briefing!.questions[0]!.answerMarkdown).toBe(
      "A tighter answer.",
    );
    expect(stored.value.briefing!.questions[1]).toEqual(pack.questions[1]);
  });

  it("refuses edits that would change more than a pack's answers", async () => {
    const current = await workspace.read(scope, "briefings", "pack");
    const at = current.origin;
    await expect(
      adapter().buildProposal!(scope, at, {
        briefingAnswers: [{ id: "missing", answerMarkdown: "x" }],
      }),
    ).rejects.toMatchObject({ code: "proposal-invalid" });
    await expect(
      adapter().buildProposal!(scope, at, {
        answer: { title: "x" },
      }),
    ).rejects.toMatchObject({
      hint: "This is a briefing pack: change its answers with briefingAnswers.",
    });
    // A hand-made patch that rewrites the context, or forges evidence, is
    // refused or stripped at validation.
    const briefing = current.value.briefing!;
    await expect(
      adapter().validateProposal(
        scope,
        proposal(
          {
            briefing: {
              ...briefing,
              context: { ...briefing.context, company: "Other" },
            },
          },
          at,
        ),
      ),
    ).rejects.toMatchObject({
      hint: "A proposal may change a pack's answers only.",
    });
    await workspace.transaction(scope, (tx, s) =>
      adapter().applyProposal(
        tx,
        s,
        proposal(
          {
            briefing: {
              ...briefing,
              questions: briefing.questions.map((question) =>
                question.id === "q2"
                  ? {
                      ...question,
                      answerMarkdown: "Forged",
                      evidenceRefs: answer("x", "x").evidenceRefs,
                    }
                  : question,
              ),
            },
          },
          at,
        ),
      ),
    );
    const stored = await workspace.read(scope, "briefings", "pack");
    expect(stored.value.briefing!.questions[1]).toMatchObject({
      answerMarkdown: "Forged",
      evidenceRefs: [],
    });
  });

  it("reads a concept brief but cannot change it", async () => {
    await workspace.transaction(scope, (tx, s) =>
      tx.query(
        "INSERT INTO interview.concept_briefs(tenant_id,actor_id,product_id,id,kind,topic,value) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
        [
          s.tenantId,
          s.actorId,
          s.productId,
          "brief-1",
          "concept",
          "React re-renders",
          JSON.stringify({ headline: "State, parents, context." }),
        ],
      ),
    );
    const at = {
      workspaceId: "concept-briefs",
      artifactId: "brief-1",
      artifactRevision: 0,
    };
    const context = await adapter().getContext(scope, at);
    expect(context.context).toMatchObject({
      kind: "concept",
      topic: "React re-renders",
      brief: { headline: "State, parents, context." },
    });
    expect(context.instructions?.join(" ")).toContain(
      "do not call proposePatch",
    );
    await expect(
      adapter().buildProposal!(scope, at, { notes: "x" }),
    ).rejects.toMatchObject({ code: "proposal-invalid" });
    await expect(
      adapter().getContext(scope, { ...at, artifactId: "missing" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("describes nothing for a coding draft's briefing-free patch", () => {
    expect(
      describeChanges(
        { question: "Q", notes: "", answer: null },
        { notes: "New notes" },
      ).map((change) => change.id),
    ).toEqual(["notes"]);
  });
});
