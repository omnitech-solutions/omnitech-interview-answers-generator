import { createHash } from "node:crypto";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  buildContextSnapshot,
  ContextSnapshotError,
  DEVICE_MAX_TOTAL_CHARS,
  DEVICE_TASK_VIEW_LIMITS,
  isUntrustedSource,
  selectSourcesForTask,
  TASK_VIEW_LIMITS,
  verifyMatrixHash,
} from "./context-snapshot.js";

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
