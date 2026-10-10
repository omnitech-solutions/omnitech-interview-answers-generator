import type { DocumentField } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { groupFields, groupIdOf, revisionNote } from "./documents-model";

const field = (
  key: string,
  source: DocumentField["source"],
  section?: string,
): DocumentField => ({
  key,
  label: key,
  source,
  required: true,
  maxLength: null,
  ...(section ? { section } : {}),
});

describe("groupFields", () => {
  it("follows the template's headings, in the order they first appear", () => {
    const groups = groupFields([
      field("name", "candidate-profile", "Header"),
      field("company", "candidacy", "Header"),
      field("summary", "candidate-profile", "Professional summary"),
      field("skills", "candidate-profile", "Core skills"),
      field("more_summary", "candidate-profile", "Professional summary"),
    ]);
    expect(groups.map((group) => [group.title, group.fields.length])).toEqual([
      ["Header", 2],
      ["Professional summary", 2],
      ["Core skills", 1],
    ]);
  });

  it("groups by where values come from when the template has no headings", () => {
    const groups = groupFields([
      field("company", "candidacy"),
      field("opening", "candidate-profile"),
      field("closing", "candidate-profile"),
    ]);
    expect(groups.map((group) => group.title)).toEqual([
      "From the application",
      "Written from your experience",
    ]);
  });

  it("gives a field the same group id it was grouped under", () => {
    const sectioned = field("a", "candidacy", "Header");
    expect(groupFields([sectioned])[0]?.id).toBe(groupIdOf(sectioned));
  });
});

describe("revisionNote", () => {
  it("says how a first revision came to be: written by a model or made by hand", () => {
    expect(revisionNote({ kind: "generated" }, [])).toBe("Generated");
    expect(revisionNote({ kind: "manual" }, [])).toBe("Created manually");
    expect(revisionNote({ kind: "edited" }, [])).toBe("Edited");
  });
});
