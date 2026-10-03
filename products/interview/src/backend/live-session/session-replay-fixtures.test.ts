// E-A1: the replay fixtures are synthetic and anonymised. This scan asserts
// they hold no real names, employers, contacts or compensation figures, and
// that any proper noun comes from the placeholder-only list.
import { describe, expect, it } from "vitest";
import {
  allFixtureTexts,
  FIXTURE_PLACEHOLDERS,
  RECRUITER_SCREEN,
} from "./session-replay-fixtures.js";

const MONEY_PATTERNS: readonly RegExp[] = [
  /[$€£¥]\s?\d/,
  /\b\d[\d,.]*\s?(k|K|m|M)\b/,
  /\b\d{1,3}(,\d{3})+\b/,
  /\b\d+\s?(usd|cad|eur|gbp|dollars?|euros?|pounds?|bucks)\b/i,
  /\b(salary|base pay|per (year|hour)|annually|a year)\b.*\d/i,
];
const CONTACT_PATTERNS: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/,
  /https?:\/\//i,
  /\bwww\./i,
];
const REAL_EMPLOYERS = [
  "google",
  "amazon",
  "microsoft",
  "meta",
  "apple",
  "netflix",
  "shopify",
  "stripe",
  "uber",
  "airbnb",
  "salesforce",
  "oracle",
  "ibm",
  "linkedin",
  "twitter",
  "spotify",
  "atlassian",
  "deloitte",
  "accenture",
];

describe("synthetic replay fixtures", () => {
  const texts = allFixtureTexts();

  it("hold no currency amounts or compensation figures", () => {
    for (const text of texts)
      for (const pattern of MONEY_PATTERNS)
        expect({
          text,
          pattern: String(pattern),
          hit: pattern.test(text),
        }).toMatchObject({ hit: false });
  });

  it("scan patterns are not vacuous: they catch representative violations", () => {
    for (const bad of [
      "I was on $120 an hour",
      "around 150k base",
      "about 100,000 a year",
      "wanting 90 usd",
      "salary was 85",
    ])
      expect(MONEY_PATTERNS.some((pattern) => pattern.test(bad))).toBe(true);
    for (const bad of ["mail me at jo@example.org", "call 555-123-4567"])
      expect(CONTACT_PATTERNS.some((pattern) => pattern.test(bad))).toBe(true);
  });

  it("hold no contact details", () => {
    for (const text of texts)
      for (const pattern of CONTACT_PATTERNS)
        expect(pattern.test(text)).toBe(false);
  });

  it("name no real employer", () => {
    for (const text of texts) {
      const lower = text.toLowerCase();
      for (const employer of REAL_EMPLOYERS)
        expect(new RegExp(`\\b${employer}\\b`).test(lower)).toBe(false);
    }
  });

  it("use only placeholder proper nouns", () => {
    const allowed = new Set<string>([
      "I",
      ...[
        ...FIXTURE_PLACEHOLDERS.people,
        ...FIXTURE_PLACEHOLDERS.companies,
      ].flatMap((name) => name.split(" ")),
    ]);
    const unexpected: string[] = [];
    for (const text of texts) {
      // A capitalised word that does not start a sentence is a proper noun.
      for (const match of text.matchAll(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+\b/g)) {
        if (!allowed.has(match[0])) unexpected.push(match[0]);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("carries the E-A1 structure of a recruiter screen", () => {
    const flat = RECRUITER_SCREEN.flatMap((phase) => phase.segments);
    expect(flat.some((s) => /^mm-hm$/.test(s.text))).toBe(true);
    expect(flat.some((s) => s.supersedes !== undefined)).toBe(true);
    expect(flat.some((s) => /part two/i.test(s.text))).toBe(true);
    expect(flat.some((s) => /circle back/i.test(s.text))).toBe(true);
    expect(flat.some((s) => s.text.split(" ").length > 40)).toBe(true);
    expect(flat.every((s) => s.endMs > s.startMs)).toBe(true);
  });
});
