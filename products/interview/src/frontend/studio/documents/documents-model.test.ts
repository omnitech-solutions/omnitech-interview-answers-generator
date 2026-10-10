import type { DocumentField } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  claimReason,
  exportBlockers,
  FIELD_STATE_TEXT,
  fieldState,
  groupFields,
  groupIdOf,
  revisionNote,
} from "./documents-model";

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

describe("what a field asks of the person", () => {
  const one = (
    source: "candidate-profile" | "candidacy" = "candidate-profile",
  ): DocumentField => ({
    key: "k",
    label: "K",
    source,
    required: true,
    maxLength: null,
  });
  const none = { absent: new Set<string>(), modelOwned: new Set<string>() };

  it("tells the three kinds of empty apart, and an unsupported claim from all of them", () => {
    // A fact only the person has, with no stored value.
    expect(fieldState(one(), "missing", none)).toBe("type-it");
    // The model's field, left empty for lack of evidence.
    expect(
      fieldState(one(), "missing", { ...none, modelOwned: new Set(["k"]) }),
    ).toBe("no-evidence");
    // A block that does not apply wins over everything: nothing to do.
    expect(
      fieldState(one(), "missing", { ...none, absent: new Set(["k"]) }),
    ).toBe("does-not-apply");
    expect(fieldState(one(), "unsupported", none)).toBe("unsupported");
    expect(fieldState(one(), "too-long", none)).toBe("too-long");
    expect(fieldState(one("candidacy"), "missing", none)).toBe("required");
    expect(fieldState(one(), undefined, none)).toBe("ok");
    for (const state of ["type-it", "no-evidence", "does-not-apply"] as const) {
      expect(FIELD_STATE_TEXT[state].title).not.toBe("");
      expect(FIELD_STATE_TEXT[state].body).not.toBe("");
    }
  });

  it("says why a claim failed and where it does belong", () => {
    expect(
      claimReason(
        { text: "Compass", kind: "name", foundIn: "Tidewater Learning" },
        "Plotline",
      ),
    ).toBe("“Compass” is from Tidewater Learning, not Plotline.");
    expect(claimReason({ text: "70%", kind: "figure" }, "Plotline")).toBe(
      "“70%” is not in the matrix entry for Plotline.",
    );
    expect(
      claimReason(
        { text: "Kubernetes", kind: "name" },
        "your experience matrix",
      ),
    ).toBe("“Kubernetes” is not in your experience matrix.");
  });

  it("lists the fields that stop an export, and only those", () => {
    expect(
      exportBlockers(
        [
          { key: "a", code: "missing" },
          {
            key: "b",
            code: "unsupported",
            against: "Plotline",
            missing: [{ text: "70%", kind: "figure" }],
          },
          { key: "gone", code: "unsupported" },
        ],
        [{ ...one(), key: "b", label: "Bullet" }],
      ),
    ).toEqual([
      {
        key: "b",
        label: "Bullet",
        reasons: ["“70%” is not in the matrix entry for Plotline."],
      },
      { key: "gone", label: "gone", reasons: [] },
    ]);
  });

  it("names the revisions that confirm a field or swap a client", () => {
    expect(
      revisionNote({ kind: "field-confirmed", fieldKeys: ["k"] }, [one()]),
    ).toBe("Confirmed K by you");
    expect(revisionNote({ kind: "recast" }, [])).toBe(
      "Swapped a client contract",
    );
  });
});
