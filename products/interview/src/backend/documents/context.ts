import { createHash } from "node:crypto";
import type { PlatformDatabase } from "@omnitech/database";
import { candidateMatrixSchema } from "@omnitech/interview-contracts";
import { readDocumentContextRows } from "./context.repository";

export class DocumentContextNotFound extends Error {
  constructor() {
    super("Document context not found");
  }
}

export type DocumentContext = {
  candidateProfile: unknown;
  candidateProfileSha256: string;
  candidacyValues: Record<string, string>;
  interviewValues: Record<string, string>;
  profileValues: Record<string, string>;
  missingProfileKeys: string[];
  // The fields that hold contact details: the document's, never a prompt's.
  privateKeys: string[];
};

// [SAFETY] Contact details are deliberately not in the experience matrix (it
// is shared with models and may be committed). They are kept on this machine
// and read here, into the document only: never logged, never sent to a model.
export type ContactDetails = {
  email?: string;
  phone?: string;
  portfolio?: string;
};

const CONTACT_KEYS = [
  "email",
  "email_address",
  "phone",
  "phone_number",
  "heading_phone_number",
  "portfolio",
  "portfolio_url",
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Resolve only context that belongs to this actor, before any generation. */
export async function resolveDocumentContext(
  database: PlatformDatabase,
  input: {
    tenantId: string;
    actorId: string;
    profileId: string;
    profileRevision: number;
    candidacyId: string | null;
    interviewId: string | null;
  },
  local: { contact?: ContactDetails | null } = {},
): Promise<DocumentContext> {
  if (input.interviewId && !input.candidacyId)
    throw new DocumentContextNotFound();
  const check = (row: unknown) => {
    if (!row) throw new DocumentContextNotFound();
  };
  const { profile, candidacy, interview } = await readDocumentContextRows(
    database,
    input,
    { profile: check, candidacy: check, interview: check },
  );
  if (!profile) throw new DocumentContextNotFound();

  let candidacyValues: Record<string, string> = {};
  if (candidacy) {
    candidacyValues = {
      company_name: String(candidacy["company_name"] ?? ""),
      role_title: String(candidacy["title"] ?? ""),
      target_role: String(candidacy["title"] ?? ""),
      job_description: String(candidacy["job_description"] ?? ""),
    };
  }

  let interviewValues: Record<string, string> = {};
  if (interview) {
    interviewValues = {
      interview_stage: String(interview["label"] ?? ""),
      interview_kind: String(interview["kind"] ?? ""),
    };
  }

  const matrix = candidateMatrixSchema.parse(profile["matrix"]);
  const sha256 = createHash("sha256").update(canonical(matrix)).digest("hex");
  if (sha256 !== profile["sha256"]) throw new DocumentContextNotFound();
  const candidate = matrix.candidate;
  const contact =
    typeof candidate === "object" && candidate !== null
      ? (candidate as Record<string, unknown>)
      : {};
  const text = (...names: string[]) =>
    names
      .map((name) => contact[name])
      .find(
        (value): value is string => typeof value === "string" && !!value.trim(),
      )
      ?.trim() ?? "";
  // "Calgary, AB" is a city and a province.
  const [city = "", province = ""] = text("location")
    .split(",")
    .map((part) => part.trim());
  // What the matrix states wins; the local contact details fill the rest.
  const stored = (value: string | undefined) => (value ?? "").trim();
  const email = text("email", "email_address") || stored(local.contact?.email);
  const phone = text("phone", "phone_number") || stored(local.contact?.phone);
  const portfolio =
    text("portfolio", "website", "portfolio_url") ||
    stored(local.contact?.portfolio);
  const name = text("name");
  const candidates: Record<string, string> = {
    heading_name: name,
    full_name: name,
    candidate_name: name,
    name,
    email,
    email_address: email,
    phone,
    phone_number: phone,
    heading_phone_number: phone,
    portfolio,
    portfolio_url: portfolio,
    location: text("location"),
    city,
    province,
  };
  // Facts the matrix states are used as written. The contact ones it does
  // not state stay blank for the person to type, never invented.
  const profileValues = Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value),
  );
  const missingProfileKeys = Object.keys(candidates).filter(
    (key) =>
      !profileValues[key] &&
      !["name", "full_name", "candidate_name", "heading_name"].includes(key),
  );
  return {
    candidateProfile: matrix,
    candidateProfileSha256: sha256,
    candidacyValues,
    interviewValues,
    profileValues,
    missingProfileKeys,
    privateKeys: CONTACT_KEYS,
  };
}
