import type { PlatformDatabase } from "@omnitech/database";
import { withTenant } from "@omnitech/database";
import { candidateMatrixSchema } from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";

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
};

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
): Promise<DocumentContext> {
  if (input.interviewId && !input.candidacyId)
    throw new DocumentContextNotFound();
  return withTenant(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    },
    async (db) => {
      const profile = (
        await db.execute(sql`
          SELECT r.matrix, r.sha256 FROM interview.candidate_profile_revisions r
          JOIN interview.candidate_profiles p
            ON (p.tenant_id, p.actor_id, p.product_id, p.id)
             = (r.tenant_id, r.actor_id, r.product_id, r.id)
          WHERE r.tenant_id=${input.tenantId} AND r.actor_id=${input.actorId}
            AND r.product_id=${INTERVIEW_PRODUCT_ID} AND r.id=${input.profileId}
            AND r.revision=${input.profileRevision} AND p.revoked_at IS NULL
        `)
      ).rows[0];
      if (!profile) throw new DocumentContextNotFound();

      let candidacyValues: Record<string, string> = {};
      if (input.candidacyId) {
        const candidacy = (
          await db.execute(sql`
            SELECT c.title, c.job_description, co.name AS company_name
            FROM interview.candidacies c
            JOIN interview.member_people mp
              ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
            JOIN interview.companies co
              ON co.tenant_id=c.tenant_id AND co.id=c.company_id
            WHERE c.tenant_id=${input.tenantId}::uuid
              AND c.id=${input.candidacyId}::uuid
              AND mp.user_id=${input.actorId}::uuid
          `)
        ).rows[0];
        if (!candidacy) throw new DocumentContextNotFound();
        candidacyValues = {
          company_name: String(candidacy["company_name"] ?? ""),
          role_title: String(candidacy["title"] ?? ""),
          target_role: String(candidacy["title"] ?? ""),
          job_description: String(candidacy["job_description"] ?? ""),
        };
      }

      let interviewValues: Record<string, string> = {};
      if (input.interviewId && input.candidacyId) {
        const interview = (
          await db.execute(sql`
            SELECT kind, label FROM interview.interviews
            WHERE tenant_id=${input.tenantId}::uuid
              AND id=${input.interviewId}::uuid
              AND candidacy_id=${input.candidacyId}::uuid
          `)
        ).rows[0];
        if (!interview) throw new DocumentContextNotFound();
        interviewValues = {
          interview_stage: String(interview["label"] ?? ""),
          interview_kind: String(interview["kind"] ?? ""),
        };
      }

      const matrix = candidateMatrixSchema.parse(profile["matrix"]);
      const sha256 = createHash("sha256")
        .update(canonical(matrix))
        .digest("hex");
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
            (value): value is string =>
              typeof value === "string" && !!value.trim(),
          )
          ?.trim() ?? "";
      // "Calgary, AB" is a city and a province.
      const [city = "", province = ""] = text("location")
        .split(",")
        .map((part) => part.trim());
      const email = text("email", "email_address");
      const phone = text("phone", "phone_number");
      const portfolio = text("portfolio", "website", "portfolio_url");
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
          !["name", "full_name", "candidate_name", "heading_name"].includes(
            key,
          ),
      );
      return {
        candidateProfile: matrix,
        candidateProfileSha256: sha256,
        candidacyValues,
        interviewValues,
        profileValues,
        missingProfileKeys,
      };
    },
    { database },
  );
}

import { createHash } from "node:crypto";
