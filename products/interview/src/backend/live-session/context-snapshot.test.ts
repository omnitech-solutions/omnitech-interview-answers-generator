import { createHash } from "node:crypto";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  BRIEF_CHAR_SHARE,
  buildContextSnapshot,
  ContextSnapshotError,
  DEVICE_MAX_TOTAL_CHARS,
  DEVICE_TASK_VIEW_LIMITS,
  isUntrustedSource,
  MAX_BRIEF_SOURCES,
  selectSourcesForTask,
  TASK_VIEW_LIMITS,
  verifyMatrixHash,
} from "./context-snapshot";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const PROFILE = { id: "profile-1", revision: 3, sha256: "a".repeat(64) };

const matrix = {
  candidate: { name: "Candidate", headline: "Platform engineer" },
  roles: [
    {
      company: "Example Corp",
      title: "Frontend engineer",
      technologies: ["React"],
      responsibilities: ["Built React components for the checkout"],
    },
    {
      company: "Example Corp",
      title: "Backend engineer",
      technologies: ["PostgreSQL"],
      responsibilities: ["Led a PostgreSQL migration"],
      metrics: [{ label: "uptime", value: "99.9%" }],
    },
  ],
} as unknown as CandidateMatrix;

const snapshot = (
  extra: Partial<Parameters<typeof buildContextSnapshot>[0]> = {},
) => buildContextSnapshot({ matrix, profile: PROFILE, ...extra });

describe("buildContextSnapshot", () => {
  it("makes JSON-pointer leaves of the matrix with deterministic ids pinned to the profile revision", () => {
    const built = snapshot();
    const leaf = built.sources.find(
      (source) => source.pointer === "/roles/1/responsibilities/0",
    );
    expect(leaf).toMatchObject({
      sourceKind: "candidate",
      revision: 3,
      text: "Led a PostgreSQL migration",
      id: sha("profile-1:/roles/1/responsibilities/0"),
      sha256: sha("Led a PostgreSQL migration"),
    });
    expect(built.profile).toEqual(PROFILE);
    expect(snapshot().sources).toEqual(built.sources);
  });

  it("stringifies metric numbers and escapes pointer keys", () => {
    const odd = {
      candidate: { "a/b": 5 },
      roles: [],
    } as unknown as CandidateMatrix;
    const built = buildContextSnapshot({ matrix: odd, profile: PROFILE });
    expect(built.sources.map((source) => source.pointer)).toEqual([
      "/candidate/a~1b",
    ]);
    expect(built.sources[0]?.text).toBe("5");
  });

  it("labels employer text as untrusted employer-context and preference lines as candidate-preference", () => {
    const built = snapshot({
      employer: { jobDescription: "Build things. Own the roadmap." },
      candidatePreferences:
        "Notice period: two weeks.\n- Salary expectation: negotiable.\nPrefers remote work.",
      draftRevision: 7,
    });
    const employer = built.sources.filter(
      (s) => s.sourceKind === "employer-context",
    );
    expect(employer.map((s) => s.text)).toEqual([
      "Build things.",
      "Own the roadmap.",
    ]);
    expect(employer.every(isUntrustedSource)).toBe(true);
    const prefs = built.sources.filter(
      (s) => s.sourceKind === "candidate-preference",
    );
    expect(prefs.map((s) => s.text)).toEqual([
      "Notice period: two weeks.",
      "Salary expectation: negotiable.",
      "Prefers remote work.",
    ]);
    expect(prefs[0]?.id).toBe(
      sha("candidatePreferences:Notice period: two weeks."),
    );
    expect(prefs[0]?.revision).toBe(7);
    expect(built.draftRevision).toBe(7);
    expect(built.preferences).toEqual({
      noticePeriod: true,
      compensation: true,
      other: true,
    });
  });

  it("reports no preference topics when no preferences exist and never invents a source", () => {
    const built = snapshot({
      employer: { research: "Example Corp ships apps." },
    });
    expect(built.preferences).toEqual({
      noticePeriod: false,
      compensation: false,
      other: false,
    });
    expect(
      built.sources.some((s) => s.sourceKind === "candidate-preference"),
    ).toBe(false);
    expect(built.draftRevision).toBeNull();
  });

  it("has a null profile without a matrix and keeps context sources", () => {
    const built = buildContextSnapshot({
      matrix: null,
      profile: PROFILE,
      candidatePreferences: "Notice period: one month.",
    });
    expect(built.profile).toBeNull();
    expect(built.sources).toHaveLength(1);
  });

  it("keeps preferences when the matrix exceeds the source bound", () => {
    const built = snapshot({
      candidatePreferences: "Notice period: two weeks.",
      limits: { maxSources: 3 },
    });
    expect(built.sources).toHaveLength(3);
    expect(built.preferences.noticePeriod).toBe(true);
  });

  it("drops a source longer than the bound whole instead of truncating it", () => {
    const long = "word ".repeat(100).trim();
    const built = buildContextSnapshot({
      matrix: {
        candidate: { headline: long, name: "Short" },
        roles: [],
      } as unknown as CandidateMatrix,
      profile: PROFILE,
      limits: { maxSourceChars: 50 },
    });
    expect(built.sources.map((s) => s.text)).toEqual(["Short"]);
  });

  it("deduplicates repeated context text by id", () => {
    const built = snapshot({
      candidatePreferences:
        "Notice period: two weeks.\nNotice period: two weeks.",
    });
    expect(
      built.sources.filter((s) => s.sourceKind === "candidate-preference"),
    ).toHaveLength(1);
  });

  it("rejects invalid limits with a code only", () => {
    expect(() => snapshot({ limits: { maxSources: 0 } })).toThrow(
      ContextSnapshotError,
    );
    try {
      snapshot({ limits: { maxSourceChars: -1 } });
    } catch (error) {
      expect((error as ContextSnapshotError).code).toBe("invalid_limits");
      expect((error as Error).message).toBe("invalid_limits");
    }
  });
});

describe("selectSourcesForTask", () => {
  it("ranks the matching role first using selectCandidateFragments", () => {
    const view = selectSourcesForTask(snapshot(), {
      query: "PostgreSQL migration",
      category: "experience-story",
      matrix,
    });
    const firstRole = view.find((s) => s.pointer.startsWith("/roles/"));
    expect(firstRole?.pointer.startsWith("/roles/1/")).toBe(true);
    const react = selectSourcesForTask(snapshot(), {
      query: "React checkout",
      category: "experience-story",
      matrix,
    }).find((s) => s.pointer.startsWith("/roles/"));
    expect(react?.pointer.startsWith("/roles/0/")).toBe(true);
  });

  it("applies the default task bounds and a smaller device bound", () => {
    expect(TASK_VIEW_LIMITS).toEqual({
      maxSources: 40,
      maxSourceChars: 400,
      maxTotalChars: 5_000,
    });
    expect(DEVICE_MAX_TOTAL_CHARS).toBe(2_500);
    expect(DEVICE_TASK_VIEW_LIMITS.maxTotalChars).toBe(2_500);
  });

  it("shrinks by dropping the lowest-ranked sources and never truncates a kept one", () => {
    const wide = {
      candidate: { name: "Candidate" },
      roles: Array.from({ length: 30 }, (_, index) => ({
        company: `Example Corp ${index}`,
        title: "Engineer",
        responsibilities: [`Shipped service number ${index} for the platform`],
      })),
    } as unknown as CandidateMatrix;
    const built = buildContextSnapshot({ matrix: wide, profile: PROFILE });
    const view = selectSourcesForTask(built, {
      query: "service number 29",
      category: "experience-story",
      matrix: wide,
      limits: { maxSources: 40, maxSourceChars: 400, maxTotalChars: 200 },
    });
    const total = view.reduce((sum, s) => sum + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(200);
    expect(view.length).toBeLessThan(built.sources.length);
    const byId = new Map(built.sources.map((s) => [s.id, s.text]));
    for (const source of view) expect(byId.get(source.id)).toBe(source.text);
    // The ranking is a prefix: the kept set is the head of the ordering that
    // a larger budget would also keep.
    const bigger = selectSourcesForTask(built, {
      query: "service number 29",
      category: "experience-story",
      matrix: wide,
      limits: { maxSources: 40, maxSourceChars: 400, maxTotalChars: 400 },
    });
    expect(bigger.slice(0, view.length)).toEqual(view);
  });

  it("skips an over-long source whole while keeping shorter later ones", () => {
    const m = {
      candidate: { headline: "x".repeat(300), name: "Candidate" },
      roles: [],
    } as unknown as CandidateMatrix;
    const built = buildContextSnapshot({ matrix: m, profile: PROFILE });
    const view = selectSourcesForTask(built, {
      query: "",
      category: "other",
      matrix: m,
      limits: { maxSources: 10, maxSourceChars: 100, maxTotalChars: 1_000 },
    });
    expect(view.map((s) => s.text)).toEqual(["Candidate"]);
  });

  it("caps the number of sources", () => {
    const view = selectSourcesForTask(snapshot(), {
      query: "",
      category: "other",
      matrix,
      limits: { maxSources: 2, maxSourceChars: 400, maxTotalChars: 5_000 },
    });
    expect(view).toHaveLength(2);
  });

  it("puts preferences first for logistics so notice period survives a tight budget", () => {
    const built = snapshot({
      candidatePreferences: "Notice period: two weeks.",
    });
    const view = selectSourcesForTask(built, {
      query: "when could you start",
      category: "logistics",
      matrix,
      limits: { maxSources: 1, maxSourceChars: 400, maxTotalChars: 5_000 },
    });
    expect(view[0]?.sourceKind).toBe("candidate-preference");
    const technical = selectSourcesForTask(built, {
      query: "PostgreSQL",
      category: "technical-concept",
      matrix,
      limits: { maxSources: 1, maxSourceChars: 400, maxTotalChars: 5_000 },
    });
    expect(technical[0]?.sourceKind).toBe("candidate");
  });

  it("works without a matrix", () => {
    const built = buildContextSnapshot({
      matrix: null,
      profile: null,
      candidatePreferences: "Notice period: two weeks.",
    });
    expect(
      selectSourcesForTask(built, {
        query: "x",
        category: "logistics",
        matrix: null,
      }),
    ).toHaveLength(1);
  });
});

describe("selectSourcesForTask with an employer brief", () => {
  const stories = {
    candidate: { name: "Candidate" },
    roles: [
      {
        company: "Northwind Labs",
        title: "Staff engineer",
        technologies: ["Golang"],
        responsibilities: ["Ran the on-call rotation for the payments engine"],
      },
      {
        company: "Relay Systems",
        title: "Engineer",
        technologies: ["Ruby"],
        responsibilities: [
          "Rebuilt the notification pipeline to cut delivery delays",
        ],
      },
    ],
  } as unknown as CandidateMatrix;
  const HEADER = "Employer brief: Staff Engineer at Acme";
  const withBrief = (...lines: string[]) =>
    buildContextSnapshot({
      matrix: stories,
      profile: PROFILE,
      employer: { brief: [HEADER, ...lines].join("\n") },
    });
  const isBrief = (source: { pointer: string }) =>
    source.pointer.startsWith("/context/employerBrief/");
  // The brief lines that lead the view, before the first matrix source.
  const leading = <T extends { pointer: string }>(view: readonly T[]) => {
    const end = view.findIndex((source) => !isBrief(source));
    return end < 0 ? [...view] : view.slice(0, end);
  };
  const firstRole = (view: readonly { pointer: string }[]) =>
    view.find((source) => source.pointer.startsWith("/roles/"))?.pointer;

  it("leads the view with the brief, and its lines do not use up the source count", () => {
    const view = selectSourcesForTask(
      withBrief("Must-haves: TypeScript · Postgres", "Values: ownership"),
      {
        query: "",
        category: "other",
        matrix: stories,
        limits: { maxSources: 2, maxSourceChars: 400, maxTotalChars: 5_000 },
      },
    );
    expect(view.slice(0, 3).map((source) => source.text)).toEqual([
      HEADER,
      "Must-haves: TypeScript · Postgres",
      "Values: ownership",
    ]);
    expect(view).toHaveLength(5);
    expect(view.slice(3).every((s) => s.sourceKind === "candidate")).toBe(true);
  });

  it("keeps the header first, then the lines sharing most words with the question, then the rest in the brief's order", () => {
    const view = selectSourcesForTask(
      withBrief(
        "Tech stack: Hono",
        "Values: ownership and candour",
        "Questions to ask: what values guide the team",
      ),
      {
        query: "What questions would you ask about values?",
        category: "other",
        matrix: stories,
      },
    );
    expect(view.filter(isBrief).map((source) => source.text)).toEqual([
      HEADER,
      "Questions to ask: what values guide the team",
      "Values: ownership and candour",
      "Tech stack: Hono",
    ]);
  });

  it("only counts shared words of four letters or more", () => {
    const view = selectSourcesForTask(
      withBrief("Team: six of us", "Values: you own the run"),
      { query: "who are you", category: "other", matrix: stories },
    );
    expect(view.filter(isBrief).map((source) => source.text)).toEqual([
      HEADER,
      "Team: six of us",
      "Values: you own the run",
    ]);
  });

  it("bounds the brief by count", () => {
    const view = selectSourcesForTask(
      withBrief(
        ...Array.from({ length: 30 }, (_, index) => `Prep: note ${index}`),
      ),
      { query: "", category: "other", matrix: stories },
    );
    const brief = leading(view);
    expect(MAX_BRIEF_SOURCES).toBe(24);
    expect(brief).toHaveLength(MAX_BRIEF_SOURCES);
    expect(brief.at(-1)?.text).toBe("Prep: note 22");
    // A line over the count is ordinary employer material: it follows the
    // matrix and counts like any other source.
    expect(view[MAX_BRIEF_SOURCES]?.sourceKind).toBe("candidate");
    expect(view.at(-1)?.text).toBe("Prep: note 29");
  });

  it("bounds the brief by its share of the characters, skipping a line that does not fit and keeping a shorter later one", () => {
    const long = `Prep: ${"long ".repeat(11)}line`;
    const limits = { maxSources: 40, maxSourceChars: 400, maxTotalChars: 200 };
    const view = selectSourcesForTask(withBrief(long, "Values: ownership"), {
      query: "",
      category: "other",
      matrix: stories,
      limits,
    });
    const brief = leading(view);
    expect(BRIEF_CHAR_SHARE).toBe(0.45);
    expect(HEADER.length + long.length).toBeGreaterThan(90);
    expect(brief.map((source) => source.text)).toEqual([
      HEADER,
      "Values: ownership",
    ]);
    expect(
      brief.reduce((sum, source) => sum + source.text.length, 0),
    ).toBeLessThanOrEqual(limits.maxTotalChars * BRIEF_CHAR_SHARE);
    // The matrix keeps the rest of the view.
    expect(view.length).toBeGreaterThan(brief.length);
    expect(
      view.reduce((sum, source) => sum + source.text.length, 0),
    ).toBeLessThanOrEqual(limits.maxTotalChars);
  });

  it("ranks roles by the question plus the brief lines that touch it, not the rest of the brief", () => {
    const view = selectSourcesForTask(
      withBrief(
        "Tech stack: Golang",
        "Prep: Proudest project: the Ruby pipeline rebuild",
      ),
      {
        query: "Tell me about your proudest project",
        category: "other",
        matrix: stories,
      },
    );
    expect(firstRole(view)?.startsWith("/roles/1/")).toBe(true);
  });

  it("lets every kept brief line rank the roles when none touches the question", () => {
    const task = {
      query: "Tell me about our company",
      category: "other",
      matrix: stories,
    } as const;
    expect(
      firstRole(
        selectSourcesForTask(withBrief("Tech stack: Ruby"), task),
      )?.startsWith("/roles/1/"),
    ).toBe(true);
    expect(
      firstRole(
        selectSourcesForTask(
          buildContextSnapshot({ matrix: stories, profile: PROFILE }),
          task,
        ),
      )?.startsWith("/roles/0/"),
    ).toBe(true);
  });

  it("puts a role whose company the question names first, ahead of the term scores and the candidate header", () => {
    const view = selectSourcesForTask(
      buildContextSnapshot({ matrix: stories, profile: PROFILE }),
      {
        query: "Tell me about the Golang work, or your time at Relay",
        category: "other",
        matrix: stories,
      },
    );
    expect(view[0]?.pointer.startsWith("/roles/1/")).toBe(true);
  });

  it("puts a role first when a prep line that touches the question names its company", () => {
    const view = selectSourcesForTask(
      withBrief("Prep: Proudest project: Relay, delays cut by half"),
      {
        query: "What is your proudest Golang project?",
        category: "other",
        matrix: stories,
      },
    );
    const roles = view.filter((s) => s.pointer.startsWith("/roles/"));
    expect(roles[0]?.pointer.startsWith("/roles/1/")).toBe(true);
    // A prep line that does not touch the question names nobody.
    const untouched = selectSourcesForTask(
      withBrief("Prep: Proudest project: Relay, delays cut by half"),
      { query: "Any Golang work?", category: "other", matrix: stories },
    );
    expect(firstRole(untouched)?.startsWith("/roles/0/")).toBe(true);
  });

  it("gives the question's company the lead over a prep line's company", () => {
    const view = selectSourcesForTask(
      withBrief("Prep: Proudest project: Relay, delays cut by half"),
      {
        query: "Northwind aside, what is your proudest project?",
        category: "other",
        matrix: stories,
      },
    );
    const roles = view
      .filter((s) => s.pointer.startsWith("/roles/"))
      .map((s) => s.pointer.slice(0, "/roles/0".length));
    expect([...new Set(roles)]).toEqual(["/roles/0", "/roles/1"]);
    expect(view.filter((s) => !isBrief(s))[0]?.pointer).toMatch(
      /^\/roles\/0\//,
    );
  });

  it("puts a role's spoken leaves (40 characters or more) before its short ones, each group in matrix order", () => {
    const view = selectSourcesForTask(
      buildContextSnapshot({ matrix: stories, profile: PROFILE }),
      { query: "Relay", category: "other", matrix: stories },
    );
    expect(
      view
        .filter((s) => s.pointer.startsWith("/roles/1/"))
        .map((s) => s.pointer),
    ).toEqual([
      "/roles/1/responsibilities/0",
      "/roles/1/company",
      "/roles/1/title",
      "/roles/1/technologies/0",
    ]);
  });
});

describe("verifyMatrixHash", () => {
  it("matches the canonical JSON digest regardless of key order", () => {
    const reordered = {
      roles: matrix.roles,
      candidate: matrix.candidate,
    } as unknown as CandidateMatrix;
    const canonical = (value: unknown): string =>
      Array.isArray(value)
        ? `[${value.map(canonical).join(",")}]`
        : value && typeof value === "object"
          ? `{${Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
              .join(",")}}`
          : JSON.stringify(value);
    const expected = sha(canonical(matrix));
    expect(verifyMatrixHash(matrix, expected)).toBe(true);
    expect(verifyMatrixHash(reordered, expected)).toBe(true);
    expect(verifyMatrixHash(matrix, "0".repeat(64))).toBe(false);
    expect(
      verifyMatrixHash(
        {
          ...matrix,
          candidate: { name: "Other" },
        } as unknown as CandidateMatrix,
        expected,
      ),
    ).toBe(false);
  });
});
